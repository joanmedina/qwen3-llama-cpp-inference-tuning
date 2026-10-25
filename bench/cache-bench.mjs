#!/usr/bin/env node
// cache-bench: reproduces the two prompt-cache scenarios of docs/en/04-prompt-cache-context-compaction.md against any llama-server:
//   1) "return to a long chat": an agent chat grows step by step (each request carries the whole history), ONE foreign request takes the
//      only slot, and the chat continues. The wall-clock time of that last request is the return time.
//   2) "compaction summary": a request with the same system prompt and the same messages up to a fraction of the chat (default 78 %) plus a
//      final instruction, like the summary request an agent sends when it compacts its context.
// For a hybrid (Gated DeltaNet) model both are cheap only if the server kept a context checkpoint / RAM-cache entry that covers the shared prefix;
// otherwise `processed` equals the whole prompt. Use it to size --cache-ram and --ctx-checkpoints for YOUR model and context length.
//
//   node bench/cache-bench.mjs --url http://127.0.0.1:8080 --model qwen3.6 --api-key change-me --steps 24 --step-tokens 2300 --out cache.json
//   (68 steps x 2,300 tokens reproduces the 161K-token chat of the report; allow ~10-20 minutes)
//
// The server should have a single slot (--parallel 1) and nothing else should use it while the benchmark runs. No dependencies (Node >= 20).
import {writeFileSync} from 'node:fs';
import http from 'node:http';

const arg = (name, fallback) => { const hit = process.argv.find(a => a.startsWith(`--${name}=`)); if (hit) return hit.slice(name.length + 3); const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback; };
const URL_BASE = new URL(arg('url', 'http://127.0.0.1:8080'));
const MODEL = arg('model', '');
const API_KEY = arg('api-key', '');
const STEPS = Number(arg('steps', 24));
const STEP_TOKENS = Number(arg('step-tokens', 2300));
const SUMMARY_AT = Number(arg('summary-at', 0.78));
const OUT = arg('out', '');
if (process.argv.includes('--help') || !MODEL) {
  console.log('usage: node bench/cache-bench.mjs --url <base url> --model <id> [--api-key <key>] [--steps 24] [--step-tokens 2300] [--summary-at 0.78] [--out <file.json>]');
  process.exit(MODEL ? 0 : 2);
}

// Raw node:http client (Node's fetch gives up after 300 s, which is shorter than the full re-processing this benchmark is meant to expose).
function post(body) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now(), data = JSON.stringify({model: MODEL, stream: false, ...body});
    // One connection per request (agent: false + Connection: close): the llama-server router closes the socket after a response, and reusing it
    // for the next request fails with "socket hang up".
    const req = http.request({hostname: URL_BASE.hostname, port: URL_BASE.port, path: '/v1/chat/completions', method: 'POST', timeout: 3600000, agent: false,
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Connection': 'close', ...(API_KEY ? {Authorization: `Bearer ${API_KEY}`} : {})}}, res => {
      let text = ''; res.on('data', c => { text += c; });
      res.on('end', () => { try { const j = JSON.parse(text); if (res.statusCode !== 200 || !j.choices) reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`)); else resolve({json: j, seconds: (Date.now() - t0) / 1000}); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout'))); req.end(data);
  });
}

// Deterministic code-like text of about `tokens` tokens (~3.3 characters per token), unique per step so that nothing repeats between steps.
function code(step, tokens) {
  let seed = step * 7919 + 17;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let text = `// file ${step}\n`, i = 0;
  while (text.length < tokens * 3.3) {
    const a = Math.floor(rnd() * 1e6).toString(36), b = Math.floor(rnd() * 1e6).toString(36), n = Math.floor(rnd() * 90) + 3;
    text += `export function ${a}_${i}(${b}: number, items: string[]): number {\n  const total = items.reduce((sum, item) => sum + item.length * ${n}, ${b});\n  return total % ${n + 7} === 0 ? total : total + ${i};\n}\n\n`;
    i++;
  }
  return text;
}

const SYSTEM = {role: 'system', content: 'You are a coding agent. Read the files you are given and answer only "ok <number>".'};
const KW = {chat_template_kwargs: {enable_thinking: false, preserve_thinking: true}, max_tokens: 4, seed: 1, thinking_budget_tokens: 0};
const history = [SYSTEM];
const row = (name, r) => ({name, promptTokens: r.json.usage?.prompt_tokens, processed: r.json.timings?.prompt_n, cached: r.json.timings?.cache_n ?? 0, seconds: +r.seconds.toFixed(1)});
const rows = [];

console.log(`cache-bench | ${URL_BASE.origin} | model ${MODEL} | ${STEPS} steps x ~${STEP_TOKENS} tokens | summary at ${(100 * SUMMARY_AT).toFixed(0)} %`);
const t0 = Date.now();
await post({messages: [{role: 'user', content: 'Reply only: ok'}], ...KW});                                            // loads the model in router mode
const anchors = new Map();                                                                                          // history length at the end of each step
for (let step = 1; step <= STEPS; step++) {
  history.push({role: 'user', content: `Step ${step}. File contents follow.\n\n${code(step, STEP_TOKENS)}`});
  const r = await post({messages: [...history], ...KW});
  history.push({role: 'assistant', content: `ok ${step}`});
  anchors.set(step, history.length);
  if (step === 1 || step % 8 === 0 || step === STEPS) console.log(`  step ${String(step).padStart(3)}: prompt ${r.json.usage?.prompt_tokens} tokens, processed ${r.json.timings?.prompt_n}, cached ${r.json.timings?.cache_n ?? 0}, ${r.seconds.toFixed(1)} s`);
  if (step === STEPS) rows.push(row(`last step of the build-up`, r));
}
const chatTokens = rows[0].promptTokens;
console.log(`chat built: ~${chatTokens} tokens in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const foreign = await post({messages: [{role: 'system', content: 'You answer with one word.'}, {role: 'user', content: 'Say pong.'}], ...KW});
rows.push(row('foreign request (takes the only slot)', foreign));
history.push({role: 'user', content: `Step ${STEPS + 1}. File contents follow.\n\n${code(STEPS + 1, STEP_TOKENS)}`});
rows.push(row(`RETURN to the chat (+1 step)`, await post({messages: [...history], ...KW})));

const upTo = Math.max(2, Math.floor(STEPS * SUMMARY_AT));
const prefix = history.slice(0, anchors.get(upTo));
rows.push(row(`COMPACTION SUMMARY (prefix = first ${upTo} of ${STEPS} steps)`, await post({messages: [...prefix, {role: 'user', content: 'Summarise everything above in ten lines.'}], ...KW})));

console.log(`\n| request | prompt tokens | processed | from cache | seconds |\n|---|---|---|---|---|`);
for (const r of rows) console.log(`| ${r.name} | ${r.promptTokens} | ${r.processed} | ${r.cached} | ${r.seconds} |`);
console.log(`\nIf "processed" of the RETURN or the SUMMARY row is close to the prompt size, the server had no checkpoint/cache entry for that prefix:\nraise --cache-ram (saved chat ~ 12-40 MiB per 1K tokens + one checkpoint per ${8192} tokens kept) and keep --ctx-checkpoints >= 8.`);
if (OUT) { writeFileSync(OUT, JSON.stringify({url: URL_BASE.origin, model: MODEL, steps: STEPS, stepTokens: STEP_TOKENS, summaryAt: SUMMARY_AT, chatTokens, rows}, null, 1)); console.log(`written ${OUT}`); }
