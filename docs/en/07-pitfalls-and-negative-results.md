# 07 · Pitfalls and negative results

[← Recipes](06-recipes.md) · [Index](../../README.md) · [Next: Limitations →](08-limitations.md)

Negative results are results: each row below is something that was tried, measured and **not** adopted, or a failure that cost time before it was understood. Numbers refer to the starting point of the corresponding experiment.

## 1. Tried, measured, not adopted

| Idea | Result | Where |
|---|---|---|
| 3 or 4 MTP draft tokens instead of 2 (Qwen3.6, MoE) | +5 % / +8 % on copying, **−21 % on prose, −12 % agent steps, −11 % reasoning** (4 vs 2) | [03 §3](03-speculative-decoding.md) |
| Probabilistic draft sampling; minimum draft probability 0.5 | +2–8 % copy/edit, **loses on reasoning** | [03 §3](03-speculative-decoding.md) |
| `ngram-map-k` self-speculation | no gain over MTP alone (57.7 vs 59.3 mean) | [data](../../data/qwen36-ngram-mod-repeat-penalty.json) |
| `ngram-mod` window other than the defaults | 16/16/64, 16/8/64, 20/20/96 all within noise (89.6–92.5 tok/s); below 16 the server warns `n_match=12 is too small` and is slower | [03 §4](03-speculative-decoding.md) |
| `ngram-mod` **without** the MTP head (Qwen3.6) | mean 82.4 vs 95.3; reasoning −10 % | [03 §4](03-speculative-decoding.md) |
| MTP 3/4 on top of `ngram-mod` (Qwen3.8, dense) | tie with MTP 2 (±2 %); lower acceptance when reasoning (73 → 62 → 56 %) | [03 §7](03-speculative-decoding.md) |
| Fewer CPU threads (2/4/8 of 16) and no busy-poll | +0 to +3 %: noise. The model runs entirely on the GPU | [data](../../data/qwen36-ngram-mod-repeat-penalty.json) |
| Larger micro-batch (`ubatch 2048`, `batch 4096`) | prefill **−23 to −28 %** | [04 §8](04-prompt-cache-context-compaction.md) |
| KV cache `f16` instead of `q8_0` | no speed change (`q8_0` halves the memory) | [04 §8](04-prompt-cache-context-compaction.md) |
| `--backend-sampling` (experimental) | 60.0 vs 59.7 tok/s: no effect | [data](../../data/qwen36-ngram-mod-repeat-penalty.json) |
| Splitting across the iGPU and an RTX 3080 Ti (Vulkan + CUDA, 80:20) | generation **−20 %**, prefill −10 to −18 % | [fig. 9](../../figures/en/fig09-igpu-vs-dual-gpu.svg) |
| 4 context checkpoints to save RAM | saves ~1.7 GiB per saved chat; every compaction summary costs **313 s** instead of 15 s | [04 §5](04-prompt-cache-context-compaction.md) |
| Bigger thinking budgets ("High", or no control) | not more accurate than Medium; can think 81 s and be cut at the token cap | [05 §3](05-thinking-budgets.md) |

## 2. Failures that were invisible until measured

| Symptom | Cause | Fix |
|---|---|---|
| The client's **"Off"** thinking level changes nothing; "trivial" questions take seconds | the client sends no control, so the server thinks up to its default cap (8,192 tokens) | send `chat_template_kwargs {"enable_thinking": false}` for Off ([05 §2](05-thinking-budgets.md)) |
| **HTTP 500** for every chat at the client's "High" level on Qwen3.8 | the client sends `reasoning_effort: high`; the template only accepts `xhigh`, `medium`, `low` and raises | map `high → xhigh` |
| Every new chat waits **~23 s** before answering | a hidden *session title* request (same model, no thinking control, 4,096-token cap) holds the only slot while it reasons | the title request must run with thinking off: 22.8 s → 0.5 s |
| Agent ends with **"Output token limit reached"**; "continue" does not help; the context gauge shows 50 % | client believed 262,144, the slot had 131,072 → the client never reached its compaction threshold and the server truncated | declare the real per-slot context ([04 §6](04-prompt-cache-context-compaction.md)) |
| Returning to a long chat re-processes everything (**> 5 min** on Qwen3.8) | `prompt state size … exceeds cache size limit`: the saved state is larger than `--cache-ram` | size `cache-ram` from the formula; keep ≥ 8 checkpoints ([04 §4](04-prompt-cache-context-compaction.md)) |
| Context compaction takes **5 minutes** instead of seconds | too few checkpoints: none lies before the summary request's prefix | `ctx-checkpoints ≥ 8` |
| An agent that sends a `system` message mid-conversation gets an error | the stock Qwen3.6 template raises *"System message must be at the beginning"* | one-line template patch ([06 §1.3](06-recipes.md)) |
| `failed to parse server config file` and the router never opens its port | the INI file starts with a **byte-order mark** (PowerShell 5.1 `Set-Content -Encoding UTF8`) | write the file without a BOM |
| **`draft-mtp` does nothing** (acceptance 0 on every request) | the GGUF has no MTP tensors — some community re-quantisations and fine-tunes drop them | check with `tools/gguf-header.mjs` before downloading 20 GB |
| A dashboard that polls the model **loads or evicts** models | monitoring requests without `autoload=false` count as requests | use `?model=<id>&autoload=false` on `/props`, `/slots`, `/metrics` |

## 3. Measurement traps (they changed conclusions before they were understood)

| Trap | Symptom | Defence |
|---|---|---|
| **Cold machine** | the first run after a restart or a model load is ~30 % slower with identical text and acceptance (82.0 vs 112.6 / 113.5 tok/s) | warm up, discard the first run, never measure right after a restart |
| **Repeated texts inflate copy/edit** | a Qwen3.6 fine-tune with the same architecture copied at 131 → 168 → 233 tok/s over three runs of the *same* texts (base Qwen3.6: 118 → 165 → 148) | change the texts between variants or compare back to back; the shared n-gram pool is the probable cause (not verified) |
| **Memory placement** | the same configuration was ~15 % slower while weights sat in shared rather than dedicated memory | keep the resident set inside the dedicated memory |
| **Client timeouts** | a 300 s client limit cut the very run that was supposed to show the problem (full re-processing) | a longer timeout or `node:http` |
| **Estimates from another model** | an early estimate of Qwen3.6's checkpoint size (≈188 MiB) was 3× too large against the measured 62.8 MiB and led to a wrong "it won't fit" claim | measure each model |
| **Averages hide the mix** | `ngram-mod` is +113 % on copying and +0.5 % on reasoning | always report per-workload numbers, and say how much of *your* traffic is copying |
