#!/usr/bin/env node
// thinking-check: sends the SAME reasoning prompt (fixed seed) with no thinking control, with thinking switched off, and with thinking budgets,
// and prints how much each variant thought and how long it took. It shows what the controls of docs/en/05-thinking-budgets.md do on YOUR server and
// that `thinking_budget_tokens` and its alias `reasoning_budget_tokens` behave the same.
//
//   node bench/thinking-check.mjs --url http://127.0.0.1:8080 --model qwen3.6 --api-key change-me [--budgets 32,512,2048] [--max-tokens 1200] [--out thinking.json]
//
// For Qwen3.8 add --effort medium (sent as chat_template_kwargs.reasoning_effort; the template accepts xhigh | medium | low only).
// Needs a server started with --reasoning on and --reasoning-format deepseek (the reasoning comes back in `reasoning_content`). No dependencies (Node >= 20).
import {writeFileSync} from 'node:fs';

const arg = (name, fallback) => { const hit = process.argv.find(a => a.startsWith(`--${name}=`)); if (hit) return hit.slice(name.length + 3); const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback; };
const BASE = arg('url', 'http://127.0.0.1:8080').replace(/\/$/, '');
const MODEL = arg('model', '');
const API_KEY = arg('api-key', '');
const BUDGETS = arg('budgets', '32,512,2048').split(',').map(Number);
const MAX_TOKENS = Number(arg('max-tokens', 1200));
const EFFORT = arg('effort', '');
const OUT = arg('out', '');
if (process.argv.includes('--help') || !MODEL) {
  console.log('usage: node bench/thinking-check.mjs --url <base url> --model <id> [--api-key <key>] [--budgets 32,512,2048] [--max-tokens 1200] [--effort medium] [--out <file.json>]');
  process.exit(MODEL ? 0 : 2);
}

const PROMPT = 'Three boxes are labelled "apples", "oranges" and "mixed", and every label is wrong. You may take one fruit out of one box without looking inside. Work out which single box to pick from and what each box contains. Reason it through carefully before answering.';
const kwargs = (enable) => ({chat_template_kwargs: {enable_thinking: enable, preserve_thinking: true, ...(EFFORT && enable ? {reasoning_effort: EFFORT} : {})}});
const variants = [
  {name: 'no control (server default budget)', extra: {}},
  {name: 'enable_thinking: false', extra: kwargs(false)},
  ...BUDGETS.flatMap(n => [
    {name: `thinking_budget_tokens: ${n}`, extra: {...kwargs(true), thinking_budget_tokens: n}},
    {name: `reasoning_budget_tokens: ${n} (alias)`, extra: {...kwargs(true), reasoning_budget_tokens: n}},
  ]),
];

const rows = [];
for (const v of variants) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/v1/chat/completions`, {method: 'POST', headers: {'Content-Type': 'application/json', ...(API_KEY ? {Authorization: `Bearer ${API_KEY}`} : {})},
    body: JSON.stringify({model: MODEL, messages: [{role: 'user', content: PROMPT}], max_tokens: MAX_TOKENS, seed: 7, ...v.extra})});
  const json = await res.json();
  if (!res.ok || !json.choices) { console.error(`${v.name}: HTTP ${res.status} ${JSON.stringify(json).slice(0, 200)}`); process.exit(1); }
  const m = json.choices[0].message;
  const reasoning = m.reasoning_content ?? m.reasoning ?? '';
  rows.push({variant: v.name, reasoningChars: reasoning.length, contentChars: (m.content ?? '').length, completionTokens: json.usage?.completion_tokens, finish: json.choices[0].finish_reason, seconds: +((Date.now() - t0) / 1000).toFixed(1)});
  const r = rows[rows.length - 1];
  console.log(`${r.variant.padEnd(40)} reasoning ${String(r.reasoningChars).padStart(6)} chars | answer ${String(r.contentChars).padStart(5)} chars | ${String(r.completionTokens).padStart(5)} tokens | ${r.finish} | ${r.seconds} s`);
}
console.log('\n| variant | reasoning chars | answer chars | completion tokens | seconds |\n|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.variant} | ${r.reasoningChars} | ${r.contentChars} | ${r.completionTokens} | ${r.seconds} |`);
if (OUT) { writeFileSync(OUT, JSON.stringify({url: BASE, model: MODEL, date: new Date().toISOString(), prompt: PROMPT, maxTokens: MAX_TOKENS, rows}, null, 2)); console.log(`\nwritten ${OUT}`); }
