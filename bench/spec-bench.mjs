#!/usr/bin/env node
// spec-bench: measures generation speed, speculative-decoding acceptance and prompt-processing speed of ANY llama-server endpoint
// (single model or router mode) with fixed seeds and workloads that mimic what a coding agent does. No dependencies (Node >= 20).
//
//   node bench/spec-bench.mjs --url http://127.0.0.1:8080 --model qwen3.6 --api-key change-me --label baseline --out baseline.json
//   node bench/spec-bench.mjs ... --loads copy,edit,edit-tool,reasoning --seeds 11,23 --pp 8000,32000
//
// What it reports (all read from the `timings` object that llama-server returns with every response):
//   TG  = tokens/s of generation (predicted_per_second)         PP = tokens/s of prompt processing (prompt_per_second)
//   acceptance = draft_n_accepted / draft_n (speculative decoding; 0/0 when the server does not speculate)
//
// Workloads (each one changes what speculative decoding can do):
//   copy        copy a ~1.4 KB code fragment verbatim            -> n-gram self-speculation shines
//   edit        rewrite the fragment adding a comment per function
//   edit-tool   one `edit` tool call whose old_string is copied from the context (what agents do all day)
//   prose       ~300 words of explanation                         -> little to copy, MTP only
//   reasoning   free reasoning with a bounded thinking budget      -> n-gram has nothing to match
// The code fragments below are synthetic and bundled; replace them with your own code to model your workload.
//
// Methodology notes (see docs/en/02-methodology.md): warm the server first (the script sends one load request and one warm-up),
// do not measure right after a restart, keep other clients off the server, and compare variants measured back to back.
import {writeFileSync} from 'node:fs';

// ------------------------------------------------------------------ arguments
const arg = (name, fallback) => { const hit = process.argv.find(a => a.startsWith(`--${name}=`)); if (hit) return hit.slice(name.length + 3); const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback; };
const URL_BASE = arg('url', 'http://127.0.0.1:8080').replace(/\/$/, '');
const MODEL = arg('model', '');
const API_KEY = arg('api-key', '');
const LABEL = arg('label', 'run');
const OUT = arg('out', '');
const SEEDS = arg('seeds', '11,23').split(',').map(Number);
const LOADS = arg('loads', 'copy,edit,edit-tool,prose,reasoning').split(',');
const PP = arg('pp', '').split(',').filter(Boolean).map(Number);          // prompt sizes in tokens, e.g. 8000,32000 (empty = skip)
const TIMEOUT_MS = Number(arg('timeout-s', '900')) * 1000;
if (process.argv.includes('--help') || !MODEL) {
  console.log('usage: node bench/spec-bench.mjs --url <base url> --model <model id> [--api-key <key>] [--label <name>] [--out <file.json>] [--seeds 11,23] [--loads copy,edit,edit-tool,prose,reasoning] [--pp 8000,32000]');
  process.exit(MODEL ? 0 : 2);
}

// ------------------------------------------------------------------ synthetic code fragments (original, MIT-licensed with this repo)
const FRAGMENTS = [
`export function readJson<T>(path: string): T | undefined {
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** True when a file was modified in the last \`ms\` milliseconds. */
export function isRecent(path: string, ms: number, now = Date.now()): boolean {
  try {
    return now - statSync(path).mtimeMs < ms;
  } catch {
    return false;
  }
}

export function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
}`,
`export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  factor: number;
}

export async function withRetry<T>(task: () => Promise<T>, options: RetryOptions): Promise<T> {
  let delay = options.baseDelayMs;
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts) break;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= options.factor;
    }
  }
  throw lastError;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}`,
`export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly capacity: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}`];

const EDIT_TOOL = [{type: 'function', function: {name: 'edit', description: 'Replace an exact text in a file by another one. old_string must appear verbatim in the file.',
  parameters: {type: 'object', properties: {path: {type: 'string'}, old_string: {type: 'string'}, new_string: {type: 'string'}}, required: ['path', 'old_string', 'new_string']}}}];

const LOAD_DEFS = {
  copy: {max: 620, think: 0, messages: k => [{role: 'user', content: `Copy the following code fragment verbatim, without changing anything and without any comment of your own. Answer only with the fragment inside a code block.\n<<<START\n${FRAGMENTS[k]}\nEND>>>`}]},
  edit: {max: 620, think: 0, messages: k => [{role: 'user', content: `Rewrite the following TypeScript fragment adding, above every function, a one-line comment saying what it is for. Return the complete fragment in a code block.\n${FRAGMENTS[k]}`}]},
  'edit-tool': {max: 900, think: 0, tools: EDIT_TOOL, messages: k => [{role: 'system', content: 'You are a coding agent. To modify files always use the edit tool.'},
    {role: 'user', content: `File src/module.ts (excerpt):\n\`\`\`\n${FRAGMENTS[k]}\n\`\`\`\nUse the edit tool to add, at the start of the first function, a guard that returns the neutral value when the input is empty. old_string must be the EXACT text of the whole first function and new_string the same function with the change.`}]},
  prose: {max: 420, think: 0, messages: () => [{role: 'user', content: 'Explain in about 300 words, with one example, how a prefix cache in a language-model server works and why it matters for an agent that repeats its whole history at every step.'}]},
  reasoning: {max: 520, think: 480, messages: () => [{role: 'user', content: 'I have three boxes labelled "apples", "oranges" and "mixed", and every label is wrong. I may take one fruit from one box. Reason step by step to work out the content of all three boxes.'}]},
};

// ------------------------------------------------------------------ http
const headers = {'Content-Type': 'application/json', ...(API_KEY ? {Authorization: `Bearer ${API_KEY}`} : {})};
async function chat(body) {
  const t0 = Date.now();
  const r = await fetch(`${URL_BASE}/v1/chat/completions`, {method: 'POST', headers, body: JSON.stringify({model: MODEL, stream: false, ...body}), signal: AbortSignal.timeout(TIMEOUT_MS)});
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!r.ok || !json?.choices) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  return {json, seconds: (Date.now() - t0) / 1000};
}
const lcp = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
const codeOf = text => { const m = (text || '').match(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)(```|$)/); return (m ? m[1] : text || '').replace(/^\s*\n/, '').replace(/\s+$/, ''); };
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const f1 = x => Number.isFinite(x) ? x.toFixed(1) : '-';

// ------------------------------------------------------------------ run
console.log(`spec-bench | ${LABEL} | ${URL_BASE} | model ${MODEL} | seeds ${SEEDS.join(',')} | loads ${LOADS.join(',')}${PP.length ? ` | pp ${PP.join(',')}` : ''}`);
const t0 = Date.now();
await chat({messages: [{role: 'user', content: 'Reply only: ok'}], max_tokens: 8, thinking_budget_tokens: 0});       // loads the model in router mode
await chat({messages: [{role: 'user', content: 'Count from one to forty separated by commas.'}], max_tokens: 120, thinking_budget_tokens: 0, seed: 5}); // warm-up
console.log(`loaded and warmed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const results = {label: LABEL, url: URL_BASE, model: MODEL, date: new Date().toISOString(), seeds: SEEDS, loads: {}, pp: {}};
for (const id of LOADS) {
  const def = LOAD_DEFS[id];
  if (!def) throw new Error(`unknown load ${id} (available: ${Object.keys(LOAD_DEFS).join(', ')})`);
  const perFragment = ['copy', 'edit', 'edit-tool'].includes(id);
  const runs = [];
  for (const seed of SEEDS) {
    for (const k of perFragment ? FRAGMENTS.keys() : [0]) {
      const body = {messages: def.messages(k), max_tokens: def.max, seed, thinking_budget_tokens: def.think, ...(def.tools ? {tools: def.tools} : {})};
      const {json, seconds} = await chat(body);
      const t = json.timings ?? {}, msg = json.choices[0].message;
      const row = {seed, fragment: k, seconds: +seconds.toFixed(2), tokens: t.predicted_n, tgS: t.predicted_per_second, draft: t.draft_n ?? 0, accepted: t.draft_n_accepted ?? 0};
      if (id === 'copy') row.fidelity = +(lcp(codeOf(msg.content), FRAGMENTS[k]) / FRAGMENTS[k].length).toFixed(3);
      if (id === 'edit-tool') { let a = null; try { a = JSON.parse(msg.tool_calls?.[0]?.function?.arguments || 'null'); } catch { /* malformed */ } row.calledEdit = msg.tool_calls?.[0]?.function?.name === 'edit'; row.oldStringExact = !!(a && typeof a.old_string === 'string' && a.old_string.length > 20 && FRAGMENTS[k].includes(a.old_string)); }
      runs.push(row);
    }
  }
  const draft = runs.reduce((s, r) => s + r.draft, 0), acc = runs.reduce((s, r) => s + r.accepted, 0);
  results.loads[id] = {tgS: +mean(runs.map(r => r.tgS)).toFixed(2), tokens: Math.round(mean(runs.map(r => r.tokens))), acceptance: draft ? +(acc / draft).toFixed(3) : null,
    ...(id === 'copy' ? {fidelity: +mean(runs.map(r => r.fidelity)).toFixed(3)} : {}),
    ...(id === 'edit-tool' ? {oldStringExact: `${runs.filter(r => r.oldStringExact).length}/${runs.length}`} : {}), runs};
  console.log(`TG ${id.padEnd(10)} ${f1(results.loads[id].tgS).padStart(7)} tok/s | ${results.loads[id].tokens} tokens | acceptance ${draft ? `${(100 * acc / draft).toFixed(0)} %` : 'n/a'}${results.loads[id].fidelity !== undefined ? ` | copy fidelity ${(100 * results.loads[id].fidelity).toFixed(1)} %` : ''}${results.loads[id].oldStringExact ? ` | exact old_string ${results.loads[id].oldStringExact}` : ''}`);
}
results.tgMean = +mean(Object.values(results.loads).map(l => l.tgS)).toFixed(2);
console.log(`TG mean of loads ${f1(results.tgMean)} tok/s`);

// Prompt processing: unique code-like text per request (random header) so that the prompt cache cannot help.
function filler(tokens, salt) {
  let text = `// session ${salt}\n`, i = 0;
  while (text.length < tokens * 3.3) { text += FRAGMENTS[i % FRAGMENTS.length].replace(/function (\w+)/g, (_, n) => `function ${n}${salt.slice(-4)}${i}`).replace(/class (\w+)/g, (_, n) => `class ${n}${i}`) + '\n\n'; i++; }
  return text;
}
for (const size of PP) {
  const salt = Math.random().toString(36).slice(2, 10);
  const {json, seconds} = await chat({messages: [{role: 'user', content: filler(size, salt) + '\nSummarise in one sentence what the code above is about.'}], max_tokens: 1, seed: 3, thinking_budget_tokens: 0});
  const t = json.timings ?? {};
  results.pp[size] = {promptTokens: json.usage?.prompt_tokens, processed: t.prompt_n, cached: t.cache_n ?? 0, ppS: t.prompt_per_second, seconds: +seconds.toFixed(1)};
  console.log(`PP ${String(size).padStart(6)} requested | ${json.usage?.prompt_tokens} prompt tokens (${t.prompt_n} processed, ${t.cache_n ?? 0} cached) | ${f1(t.prompt_per_second)} tok/s | ${seconds.toFixed(1)} s`);
}

// Markdown table to paste into an issue or a report
console.log(`\n| load | TG tok/s | acceptance |\n|---|---|---|`);
for (const [id, l] of Object.entries(results.loads)) console.log(`| ${id} | ${f1(l.tgS)} | ${l.acceptance === null ? 'n/a' : (100 * l.acceptance).toFixed(0) + ' %'} |`);
if (OUT) { writeFileSync(OUT, JSON.stringify(results, null, 1)); console.log(`\nwritten ${OUT}`); }
