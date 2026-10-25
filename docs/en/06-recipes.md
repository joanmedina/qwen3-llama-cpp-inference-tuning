# 06 · Recipes: configuring Qwen3.6 and Qwen3.8 step by step

[← Thinking budgets](05-thinking-budgets.md) · [Index](../../README.md) · [Next: Pitfalls and negative results →](07-pitfalls-and-negative-results.md)

Everything below was applied on the machine of [doc 01](01-hardware-and-software.md). Numbers in the "why" column are links to the evidence. Adapt device names, paths and memory to your hardware; re-measure with [`bench/spec-bench.mjs`](../../bench/spec-bench.mjs) before trusting a gain.

## 0. Prerequisites

1. A `llama-server` that knows the options used here. Check: `llama-server --help | grep -E "spec-type|ctx-checkpoints|cache-ram|reasoning-budget"`. Build **11721** (Vulkan) was used.
2. A GGUF **that ships the MTP head**. Check: `node tools/gguf-header.mjs model.gguf` → `nextn_predict_layers: 1` and tensors named `…nextn…` ([doc 03](03-speculative-decoding.md) §9). If it prints none, `draft-mtp` is not available for that file.
3. Memory: Qwen3.6-35B-A3B Q4_K_M ≈ 22.3 GB of weights, Qwen3.8-27B Q4_K_M ≈ 16.8 GB, plus KV cache, checkpoints and ~0.9 GB per vision projector.
4. On Windows with an NVIDIA card present and an AMD iGPU as target: set `VK_LOADER_DRIVERS_SELECT=*amd*` so that `Vulkan0` is the iGPU.

## 1. Qwen3.6-35B-A3B (day-to-day model)

### 1.1 Router preset (`models.ini`)

```ini
version = 1

[*]
jinja = true
n-gpu-layers = 999
flash-attn = on
parallel = 1
cache-type-k = q8_0
cache-type-v = q8_0
metrics = true
reasoning-format = deepseek
reasoning = on
reasoning-budget = 8192
batch-size = 2048
ubatch-size = 1024

[qwen3.6]
model = /models/Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf
mmproj = /models/mmproj-Qwen_Qwen3.6-35B-A3B-f16.gguf
mmproj-device = Vulkan0
image-max-tokens = 1024
ctx-size = 262144
device = Vulkan0
spec-type = draft-mtp,ngram-mod
spec-draft-n-max = 2
reasoning-budget-message = Stop thinking: act now.
cache-ram = 8192
ctx-checkpoints = 32
temp = 0.6
top-p = 0.95
top-k = 20
min-p = 0
repeat-penalty = 1.0
load-on-startup = true
```

Launch: `llama-server --models-preset models.ini --models-max 3 --host 127.0.0.1 --port 8080 --api-key <key>`. A single-model command line with the same options is in [`configs/llama-server/qwen3.6-35b-a3b.sh`](../../configs/llama-server/qwen3.6-35b-a3b.sh).

### 1.2 What each line is for

| Key | Value | Why | Evidence |
|---|---|---|---|
| `spec-type` | `draft-mtp,ngram-mod` | MTP head + n-gram self-speculation: **+73 % generation** in production | [03 §4–6](03-speculative-decoding.md) |
| `spec-draft-n-max` | `2` | 3–4 gain on copy but lose on prose/agent/reasoning; the server default is 3 | [03 §3](03-speculative-decoding.md) |
| `repeat-penalty` | `1.0` | +9 % alone, +27 % rewriting with n-gram; recommended by the model card; no quality loss in the batteries | [03 §5](03-speculative-decoding.md) |
| `ctx-size` | `262144` | native context; one slot; KV in `q8_0`. The client must declare the same number | [04 §6](04-prompt-cache-context-compaction.md) |
| `parallel` | `1` | one slot gives the full window; a second client then *queues* (visible as `requests_deferred` in `/metrics`) | [04 §1](04-prompt-cache-context-compaction.md) |
| `cache-ram` / `ctx-checkpoints` | `8192` / `32` (defaults) | return to a 161K-token chat in 14 s; summary request 15 s. **Do not go below 8 checkpoints** | [04 §3, §5](04-prompt-cache-context-compaction.md) |
| `batch-size` / `ubatch-size` | `2048` / `1024` | `ubatch 2048` is 23–28 % slower at prefill | [04 §8](04-prompt-cache-context-compaction.md) |
| `cache-type-k/v` | `q8_0` | same speed as `f16`, half the memory | [04 §8](04-prompt-cache-context-compaction.md) |
| `reasoning-budget` | `8192` | server-wide default cap on thinking; clients override per request | [05](05-thinking-budgets.md) |
| `temp` / `top-p` / `top-k` / `min-p` | `0.6 / 0.95 / 20 / 0` | the sampling used in every measurement | [02](02-methodology.md) |
| `device`, `mmproj-device` | `Vulkan0` | iGPU only; a second GPU slowed it down | [fig. 9](../../figures/en/fig09-igpu-vs-dual-gpu.svg) |

### 1.3 Chat template: system messages in the middle of a conversation

Qwen3.6's stock chat template **raises an error if a `system` message is not the first message**. Some agents (Codex, for one) send system/developer messages in mid-conversation and fail with an HTTP error. A one-line change in the template makes it pass them through (template files are Apache-2.0 derived from Qwen's; only the diff is distributed here — [`configs/chat-template/qwen3.6-system-mid-conversation.diff`](../../configs/chat-template/qwen3.6-system-mid-conversation.diff)):

```diff
     {%- if message.role == "system" %}
         {%- if not loop.first %}
-            {{- raise_exception('System message must be at the beginning.') }}
+            {#- agents send system messages mid-conversation: pass them through instead of failing #}
+            {{- '<|im_start|>system\n' + content + '<|im_end|>\n' }}
         {%- endif %}
```

Extract the embedded template with `node tools/gguf-header.mjs --chat-template model.gguf > template.jinja` (or take it from the model repository), apply the change, and pass the result with `chat-template-file = …` (with `jinja = true`).

## 2. Qwen3.8-27B (heavy / complex-task model)

```ini
[qwen3.8-27b]
model = /models/Qwen3.8-27B-Q4_K_M.gguf
mmproj = /models/mmproj-Qwen3.8-27B-BF16.gguf
mmproj-device = Vulkan0
image-max-tokens = 1024
ctx-size = 131072
device = Vulkan0
spec-type = draft-mtp,ngram-mod
spec-draft-n-max = 2
reasoning-effort = medium
cache-ram = 8192
ctx-checkpoints = 8
temp = 1.0
top-p = 0.95
top-k = 20
min-p = 0
repeat-penalty = 1.0
load-on-startup = false
```

Differences from the Qwen3.6 section and why:

| Key | Qwen3.8 | Why |
|---|---|---|
| `spec-type` / `spec-draft-n-max` | same as Qwen3.6 | 12.6 → 56.9–60.6 tok/s; MTP 2/3/4 tie once `ngram-mod` is on, 2 accepts more when reasoning ([03 §7](03-speculative-decoding.md)) |
| `cache-ram` / `ctx-checkpoints` | **`8192` / `8`** (not the `4096`/32 this preset started with; the server default is 8192/32) | the 4096/32 combination does not even save a 65K-token chat (state 7,230 MiB) → >5 min to come back; 8192/8 → 13.6 s. A 262K window would need ~12,288 ([04 §4](04-prompt-cache-context-compaction.md)) |
| `ctx-size` | `131072` | what was run; the model's native context is 262,144 (untested here: raise `cache-ram` and the client's declared window with it) |
| `temp` / `repeat-penalty` | `1.0` / `1.0` | the model card's recommended sampling for thinking mode |
| `reasoning-effort` | `medium` | default for clients that send nothing; the template accepts only `xhigh`/`medium`/`low` ([05 §1](05-thinking-budgets.md)). Clients should send `xhigh` for their "High" |
| `load-on-startup` | `false` | loaded on demand: 16.8 GB resident only when a hard task asks for it |

## 3. Which model for what

| | Qwen3.6-35B-A3B | Qwen3.8-27B |
|---|---|---|
| Generation, reasoning / edit–copy (tok/s) | ~74 / 150–170 (production) | ~25 / 64–107 (temporary router) |
| Prompt reading (tok/s) | 720 → 196 as the context grows to 200K | 225 → 149 over 2–65K |
| Cost of a checkpoint / saved chat | 62.8 MiB / 12.4 MiB per 1K tokens | 149.6 MiB / 39 MiB per 1K tokens |
| Independent quality index (Artificial Analysis v4.3.2, as checked on 2026-10-24; **not reproduced here**) | 18 | **34** (xhigh) — [source](https://artificialanalysis.ai/models/qwen3-8-27b) |

Reading: Qwen3.6 is the interactive workhorse — roughly three times faster per token because only ~3 B parameters are active; Qwen3.8 is the model to load on demand when answer quality matters more than latency. The speed numbers are ours; the quality index is a third party's.

## 4. Applying a change safely (the procedure used for every change in this repository)

1. **Back up** the preset (`cp models.ini models.ini.before`).
2. **Edit** the preset. Remember that the router reads it **only at start**.
3. **Validate** with a throwaway router on another port that loads nothing: copy the preset, replace every `load-on-startup = true` by `false`, and start `llama-server --models-preset copy.ini --models-max 1 --port 8098 --api-key probe`; `GET /models` must list the model, and `args` shows the keys it will use. **Write the copy without a byte-order mark**: Windows PowerShell 5.1's `Set-Content -Encoding UTF8` adds one, and the server answers *"failed to parse server config file"* and never opens its port.
4. **Restart** the real router when no one is generating (about one minute without service; watch the model with `GET /models`).
5. **Measure** with the same loads as before, warm ([doc 02](02-methodology.md) §5).
6. **Revert** = restore the backup and restart.

Other operations used throughout: `POST /models/unload {"model":"<id>"}` frees a model without restarting; `GET /slots?model=<id>&autoload=false` and `GET /metrics?model=<id>&autoload=false` read state without loading anything.

## 5. Agent-client settings that must match

- **Context window** = the server's real per-slot context ([doc 04](04-prompt-cache-context-compaction.md) §6): 262,144 for Qwen3.6 here, 131,072 for Qwen3.8.
- **Thinking levels** mapped to the template ([doc 05](05-thinking-budgets.md) §2); Qwen3.8 `high → xhigh`.
- **Compaction policy** that triggers well before the window is full (this work used 65 % of the window, 8,192-token headroom and retain).
- Provider/model entries for the two models: [`configs/clients/`](../../configs/clients/).
