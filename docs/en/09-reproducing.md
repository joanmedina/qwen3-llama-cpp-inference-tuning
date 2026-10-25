# 09 · Reproducing the measurements on your hardware

[← Limitations](08-limitations.md) · [Index](../../README.md) · [References →](references.md)

The goal is not to match our absolute numbers but to **measure the same effects on your machine** before changing a production configuration. Requirements: Node.js ≥ 20 (no packages), a `llama-server` with the options of [doc 06](06-recipes.md), and a GGUF with an MTP head.

## 1. Set up

```bash
git clone https://github.com/joanmedina/qwen3-llama-cpp-inference-tuning.git
cd qwen3-llama-cpp-inference-tuning
node tools/gguf-header.mjs /models/Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf     # must show nextn_predict_layers: 1 and nextn tensors
cp configs/llama-server/models.example.ini models.ini                     # edit paths and device names
llama-server --models-preset models.ini --models-max 1 --host 127.0.0.1 --port 8097 --api-key probe
```

Use a **separate port and a copy of your real preset** for experiments, and change **one key at a time** ([doc 02](02-methodology.md) §2).

## 2. Generation speed and acceptance (`bench/spec-bench.mjs`)

```bash
node bench/spec-bench.mjs --url http://127.0.0.1:8097 --model qwen3.6 --api-key probe \
     --label mtp2-ngram --seeds 11,23 --pp 8000,32000 --out results/mtp2-ngram.json
```

It loads the model (router mode), warms it up, then sends the loads of [doc 02](02-methodology.md) §3 with fixed seeds and prints, from the server's own `timings`:

```
TG copy         ... tok/s | ... tokens | acceptance .. % | copy fidelity .. %
TG edit         ...
TG edit-tool    ... | exact old_string n/n
TG prose / reasoning ...
PP   8000 requested | ... prompt tokens (... processed, 0 cached) | ... tok/s
```

Repeat with a different `spec-type` / `spec-draft-n-max` / `repeat-penalty` in the preset and compare the JSON files (the script prints a Markdown table ready to paste into an issue). Checks that tell you the experiment is valid:

- `acceptance` is non-zero for every speculative variant (0 means the server is not speculating: the GGUF has no MTP head or `spec-type` is wrong) and **exactly 0/0 (`n/a`) for the no-speculation baseline**.
- *Copy fidelity* stays high (a fast but wrong copy is not a gain).
- Run the first variant twice and discard the first run (cold machine). Do not run other clients meanwhile.

**What to expect.** The *shape* of [figures 2–5](../../figures/en/): `ngram-mod` should multiply `copy` and `edit`, leave `reasoning` almost unchanged, and `spec-draft-n-max` above 2 should help copy and hurt `prose`/`reasoning`. The absolute numbers depend on your bandwidth.

## 3. Prompt cache and compaction (`bench/cache-bench.mjs`)

```bash
node bench/cache-bench.mjs --url http://127.0.0.1:8097 --model qwen3.6 --api-key probe \
     --steps 24 --step-tokens 2300 --out results/cache-default.json
```

It grows a chat step by step (each request carries the whole history), sends one foreign request that takes the single slot, **returns to the chat**, and sends a **compaction-style summary request** over the first 78 % of the history. The table shows, for each request, the prompt size, the tokens *processed* and those read *from the cache*, and the seconds. Healthy output: the RETURN and the SUMMARY rows process only the new tokens (a few thousand at most). A "processed" close to the whole prompt means no checkpoint/RAM-cache entry covered that prefix: raise `cache-ram` and keep `ctx-checkpoints ≥ 8` ([doc 04](04-prompt-cache-context-compaction.md)). Use `--steps 68 --step-tokens 2300` to reach the ~160K-token chat of the report (it takes time: prefill at depth is slow).

Output of the validation run of this repository (Qwen3.6 with [`models.example.ini`](../../configs/llama-server/models.example.ini): `cache-ram 8192`, 32 checkpoints, 16 steps; a throwaway router, so absolute seconds are slower than in production):

```
| request                                            | prompt tokens | processed | from cache | seconds |
| last step of the build-up                          |         45294 |      2836 |      42458 |    14.9 |
| foreign request (takes the only slot)              |            26 |        26 |          0 |     4.2 |
| RETURN to the chat (+1 step)                       |         48132 |      2842 |      45290 |    14.9 |
| COMPACTION SUMMARY (prefix = first 12 of 16 steps) |         33982 |        21 |      33961 |     1.3 |
```

Run it once with `--parallel 1` (as here); with more slots the "foreign request" no longer evicts the chat and the scenario changes.

## 4. Thinking levels

```bash
node bench/thinking-check.mjs --url http://127.0.0.1:8097 --model qwen3.6 --api-key probe          # Qwen3.8: add --effort medium
```

[`bench/thinking-check.mjs`](../../bench/thinking-check.mjs) sends one reasoning prompt (fixed seed) with no control, with thinking off, and with budgets of 32 / 512 / 2048 tokens through both field names (`thinking_budget_tokens` and its alias `reasoning_budget_tokens`), and prints how much each variant thought and for how long. For your own client, send the same prompt with each mapping of [doc 05](05-thinking-budgets.md) §2 and compare `usage.completion_tokens`, `reasoning_content` length and time. For accuracy use your own small battery of problems with one checkable answer; the one used here is not published (it is easy to rebuild: 10 easy and 8 hard problems, final-answer checks, a 4,500-token cap).

## 5. Regenerating figures and tables

```bash
node figures/make-figures.mjs      # writes figures/en/*.svg and figures/es/*.svg from data/*.json
```

If you reproduce an experiment and want to share it, add your numbers as a new `data/<name>.json` following the existing files (setup, unit, values, source) and open a pull request ([CONTRIBUTING](../../CONTRIBUTING.md)).
