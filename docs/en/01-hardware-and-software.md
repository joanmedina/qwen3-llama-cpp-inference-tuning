# 01 · Hardware and software

[← Index](../../README.md) · [Next: Methodology →](02-methodology.md)

All numbers in this repository were measured on **one** machine, described here. Read it before comparing with your own results: unified-memory APUs behave differently from discrete GPUs, and several of the findings (memory placement, the dual-GPU result) depend on that.

## 1. Test machine

| Component | Detail |
|---|---|
| System | GMKtec EVO-X3 mini PC, BIOS `EVO-X3_V1.01` (2026-06-17) |
| CPU | AMD Ryzen AI Max+ 395 ("Strix Halo"), 16 cores / 32 threads; llama.cpp reports AVX2, AVX-512 (VBMI, VNNI, BF16) |
| Integrated GPU | AMD Radeon 8060S (RDNA 3.5), Windows driver `32.0.32015.7029`. Vulkan device `Vulkan0`: 114,507 MiB visible, 108,782 MiB free at start-up |
| Memory | 8 × 16 GB LPDDR5X-8000 (128 GB, unified). The BIOS dedicates **64 GB to the iGPU**; Windows sees 63.6 GB of RAM. The remaining GPU-visible memory is "shared" system memory |
| Discrete GPU | NVIDIA GeForce RTX 3080 Ti (12 GB). Used **only** in the dual-GPU experiment ([figure 9](../../figures/en/fig09-igpu-vs-dual-gpu.svg)); every other number is iGPU-only |
| NPU | present, not used in any experiment |
| OS | Windows 11 Pro, build 10.0.26200 |

The theoretical memory bandwidth of this platform is about 256 GB/s (vendor figure for LPDDR5X-8000 on a 256-bit interface; **not measured here**). Token generation of a quantised model is largely bandwidth-bound, which is why the choice of *how many tokens each memory pass produces* (speculative decoding) matters more than any compute-oriented flag.

## 2. Software

| Item | Version / setting |
|---|---|
| llama.cpp | build **11721**, commit `ff5a23376`, Clang 20.1.8, Windows x86_64. Vulkan build (`llama-server.exe`). A CUDA+Vulkan build of the same revision was used for the dual-GPU test |
| Backend | Vulkan. The environment variable `VK_LOADER_DRIVERS_SELECT=*amd*` hides the NVIDIA ICD so that `Vulkan0` is always the iGPU |
| Server mode | **router mode**: `llama-server --models-preset <file.ini> --models-max 3 --host 127.0.0.1 --port 8080 --api-key <key>` (one child process per loaded model) |
| Clients | OpenAI-compatible agents (coding harnesses) talking to `/v1/chat/completions`; the harness-side findings are described generically in [05](05-thinking-budgets.md) and [04](04-prompt-cache-context-compaction.md) |

### Router mode in two minutes

The router reads an INI file where every section is a model and every key is a `llama-server` long option without the leading dashes (see [`configs/llama-server/`](../../configs/llama-server/)). Things worth knowing, all used in this work:

- **Presets are read only when the router starts.** Editing the INI changes nothing until the next start (about one minute without service in our case).
- `load-on-startup = true|false` per model; models not loaded at start are loaded on the first request that names them. `--models-max N` bounds how many stay resident.
- `GET /models` lists every model with its state (`loaded` / `unloaded`) and the arguments it was started with. `POST /models/unload` with `{"model": "<id>"}` frees one without restarting the router.
- Monitoring endpoints accept `?model=<id>&autoload=false` (`/props`, `/slots`, `/metrics`), so a dashboard can watch a model **without ever loading it**.

## 3. Models

| | Qwen3.6-35B-A3B | Qwen3.8-27B |
|---|---|---|
| Type | Mixture of experts: 256 experts, 8 active per token (about 3 B active parameters) | Dense, 27 B parameters |
| GGUF used | Q4_K_M, 22.3 GB (bartowski quantisation) | Q4_K_M, 16.8 GB (lmstudio-community) |
| llama.cpp architecture | `qwen35moe` | `qwen35` |
| Blocks | 41 = 40 + **1 MTP layer** (`blk.40.nextn.*`) | 65 = 64 + **1 MTP layer** (`blk.64.nextn.*`) |
| Attention layout | full attention every 4th layer (10) + 30 Gated DeltaNet layers | full attention every 4th layer (16) + 48 Gated DeltaNet layers |
| Recurrent state | inner size 4096, 32 heads | inner size 6144, 48 heads |
| Native context | 262,144 tokens | 262,144 tokens |
| Vision | yes (separate `mmproj`, F16, 0.9 GB) | yes (separate `mmproj`) |
| Context checkpoint size (measured) | **62.8 MiB** | **149.6 MiB** |

The headers were read with [`tools/gguf-header.mjs`](../../tools/gguf-header.mjs); both files **ship the multi-token-prediction (MTP) head**, which is what makes `--spec-type draft-mtp` available. A GGUF without `nextn` tensors cannot use it (check yours first).

Why this matters for everything that follows: both models are **hybrids** (Gated DeltaNet linear-attention layers plus a few full-attention layers). A hybrid model keeps a *recurrent state* that cannot be partially rewound, so the server can reuse a cache only up to a saved **context checkpoint** ([doc 04](04-prompt-cache-context-compaction.md)); and the MoE/dense difference explains the very different speculative-decoding behaviour ([doc 03](03-speculative-decoding.md)).

## 4. A memory-placement observation

On a unified-memory APU the same weights can live in the *dedicated* carve-out or in *shared* system memory. While the three production models filled the 64 GB dedicated memory, temporary test routers landed in shared memory and ran **about 15 % slower** with an identical configuration (Qwen3.6 starting point: 60.3 tok/s in a temporary router vs 70.3 tok/s in production; report data in `data/qwen36-production-before-after.json`). After the dedicated memory was freed (only one 28 GB model resident), a temporary router gave numbers in line with production (115 vs 113–121 tok/s). The cause was inferred from the situation, not verified by inspecting where the weights were placed or with a profiler; treat it as a practical warning: **keep the resident set inside the dedicated memory**, and compare variants only when they were measured under the same placement.

## 5. Reading the numbers

- *tok/s* always means what the server reports in the response (`timings.predicted_per_second` for generation, `timings.prompt_per_second` for prompt processing), not client-side wall clock, except where a figure says "seconds".
- The "starting point" of every experiment is the configuration that was in production before it, stated in each table.
- Absolute speeds are specific to this machine; **relative** changes are what should transfer.
