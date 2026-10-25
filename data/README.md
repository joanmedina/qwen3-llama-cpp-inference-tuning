# Data

Every number in the tables and figures of this repository comes from one of these files. They are plain JSON, hand-transcribed from the author's measurement notebook (the "internal reports" named in each `source` field are private; this repository publishes their numbers, setups and conclusions, not the raw logs — see [limitations §5](../docs/en/08-limitations.md)).

## Conventions

| Field | Meaning |
|---|---|
| `id`, `title`, `date` | identity and date of the measurement (ISO, 2026) |
| `setup` | how it was measured: router, preset, loads, seeds, repetitions. **Read it before comparing with anything** |
| `unit` | the unit of the values: `tok/s` is the server's own `timings.predicted_per_second` (generation) or `timings.prompt_per_second` (prompt), not client wall clock |
| `source` | where the numbers were transcribed from |
| everything else | the values, grouped as the corresponding table of the documentation |

Percent changes are relative to the starting point of the same file and were computed from unrounded means; the tables round them.

## Files, figures and the pages that use them

| File | Figure | Documentation |
|---|---|---|
| [`real-usage-profile.json`](real-usage-profile.json) | 1 · where the time goes | [03 §2](../docs/en/03-speculative-decoding.md) |
| [`qwen36-mtp-draft-length.json`](qwen36-mtp-draft-length.json) | 2 · MTP draft length | [03 §3](../docs/en/03-speculative-decoding.md) |
| [`qwen36-ngram-mod-repeat-penalty.json`](qwen36-ngram-mod-repeat-penalty.json) | 3 · `ngram-mod` and `repeat-penalty` | [03 §4–5](../docs/en/03-speculative-decoding.md), [07](../docs/en/07-pitfalls-and-negative-results.md) |
| [`qwen36-production-before-after.json`](qwen36-production-before-after.json) | 4 · production before and after | [03 §6](../docs/en/03-speculative-decoding.md) |
| [`qwen38-speculative-decoding.json`](qwen38-speculative-decoding.json) | 5 · Qwen3.8 speculative decoding | [03 §7](../docs/en/03-speculative-decoding.md) |
| [`prompt-cache-checkpoints.json`](prompt-cache-checkpoints.json) | 6 · checkpoints and RAM cache | [04 §2–5](../docs/en/04-prompt-cache-context-compaction.md) |
| [`thinking-budget-levels.json`](thinking-budget-levels.json) | 7 · thinking levels | [05 §3–4](../docs/en/05-thinking-budgets.md) |
| [`prompt-processing-speed.json`](prompt-processing-speed.json) | 8 · prompt speed vs context | [04 §8](../docs/en/04-prompt-cache-context-compaction.md) |
| [`dual-gpu-vs-igpu-only.json`](dual-gpu-vs-igpu-only.json) | 9 · iGPU vs dual GPU | [01](../docs/en/01-hardware-and-software.md), [07](../docs/en/07-pitfalls-and-negative-results.md) |
| [`observations.json`](observations.json) | — | the single measurements quoted in the prose: cold start, repeated texts, memory placement, cache entry sizes, the observed compaction, the title request ([02 §5](../docs/en/02-methodology.md), [04](../docs/en/04-prompt-cache-context-compaction.md), [05 §4](../docs/en/05-thinking-budgets.md), [07 §3](../docs/en/07-pitfalls-and-negative-results.md)) |

`node figures/make-figures.mjs` regenerates `figures/en/*.svg` and `figures/es/*.svg` from these files.

## Adding your own measurement

Create `data/<your-experiment>.json` with at least `id`, `title`, `date`, `setup`, `unit`, the values and a `source` (for example the output file of [`bench/spec-bench.mjs`](../bench/spec-bench.mjs)), and state **hardware, backend, llama.cpp build, GGUF and the exact command line** in `setup` — see [CONTRIBUTING](../CONTRIBUTING.md).
