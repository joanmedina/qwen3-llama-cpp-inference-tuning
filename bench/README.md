# Benchmarks

Three dependency-free Node.js scripts (Node ≥ 20) that measure, on **your** server, the effects described in the documentation. They talk to any OpenAI-compatible `llama-server` (router mode or single model) and use only the numbers the server itself reports (`timings`).

| Script | Measures | Time | Chapter |
|---|---|---|---|
| [`spec-bench.mjs`](spec-bench.mjs) | generation speed (tok/s) and draft acceptance per workload (`copy`, `edit`, `edit-tool`, `prose`, `reasoning`) with fixed seeds; optionally prompt-processing speed (`--pp 8000,32000`) | 3–6 min | [03](../docs/en/03-speculative-decoding.md), [04 §8](../docs/en/04-prompt-cache-context-compaction.md) |
| [`cache-bench.mjs`](cache-bench.mjs) | tokens processed vs read from the cache, and seconds, when **returning to a long chat** after a foreign request took the only slot, and for a **compaction-style summary request** | 3 min (`--steps 16`) to 20 min (`--steps 68`, the 160K-token chat of the report) | [04](../docs/en/04-prompt-cache-context-compaction.md) |
| [`thinking-check.mjs`](thinking-check.mjs) | how long the same prompt thinks with no control, with thinking off, and with `thinking_budget_tokens` / `reasoning_budget_tokens` of 32, 512 and 2048 | 2–3 min | [05](../docs/en/05-thinking-budgets.md) |

```bash
node bench/spec-bench.mjs     --url http://127.0.0.1:8097 --model qwen3.6 --api-key probe --label baseline --out results/baseline.json
node bench/cache-bench.mjs    --url http://127.0.0.1:8097 --model qwen3.6 --api-key probe --steps 16
node bench/thinking-check.mjs --url http://127.0.0.1:8097 --model qwen3.6 --api-key probe          # Qwen3.8: add --effort medium
```

Rules that make the numbers worth comparing ([doc 02](../docs/en/02-methodology.md), [doc 09](../docs/en/09-reproducing.md)): a **separate port and a copy of your real preset**, **one option changed at a time**, a warm-up (the scripts do one) and the first run discarded, nothing else using the server, and the same placement of the model in memory between variants. Outputs under `results/` are git-ignored because they can contain prompts and completions; share the numbers as a [`data/`](../data/) file instead.

The bundled workloads are **synthetic**: the repetition structure of your own code and prose will change the absolute gains of `ngram-mod` (the more of the output that repeats the context, the larger the gain).
