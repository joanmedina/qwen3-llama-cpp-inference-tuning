# 08 · Limitations and threats to validity

[← Pitfalls and negative results](07-pitfalls-and-negative-results.md) · [Index](../../README.md) · [Next: Reproducing →](09-reproducing.md)

This is an engineering report from one practitioner's machine, not a controlled benchmark study. The list below says what the evidence supports, what it does not, and what was never measured.

## 1. External validity (will it transfer?)

| Limit | Consequence |
|---|---|
| **One machine**: AMD Ryzen AI Max+ 395 (Strix Halo) mini PC, 128 GB unified LPDDR5X, Windows 11, **Vulkan** backend, llama.cpp **build 11721** (October 2026) | Absolute tokens/s are specific to it. **Relative** effects (speculative decoding, checkpoints, thinking caps) should transfer to other bandwidth-bound setups; the dual-GPU and memory-placement results are specific to a unified-memory APU |
| **Other backends/OS not tested**: ROCm, CUDA-only, Metal, Linux | Vulkan-specific behaviour (e.g. flash-attention, batch sizes) may differ |
| **One quantisation per model** (Q4_K_M, from specific quantisers) | Q5/Q6/Q8/IQ variants and their MTP-acceptance or quality were not compared. Quantisation quality (perplexity/KL) was **not** measured |
| **Models**: Qwen3.6-35B-A3B and Qwen3.8-27B only | The recipes should apply to other hybrid Qwen3.x models (other releases and fine-tunes) with an MTP head, but that is an extrapolation (a cross-check on a non-Qwen hybrid showed the n-gram half generalises, [doc 03](03-speculative-decoding.md) §8) |
| **Software moves fast** | Options, defaults and speeds change between llama.cpp builds. Re-measure after upgrading; treat this as a dated snapshot |

## 2. Internal validity (are the numbers right?)

- **Small samples.** Quick batches use 3 code fragments × 1 seed; key claims were replicated with 3 × 3; production before/after is one pass each (plus three later warm runs). On the iGPU alone two identical passes differed by **±15–20 %**. Conclusions rest on effects larger than that or on replications, and the documents say so where a figure is within noise (a 15 % difference between two models measured once each is read as "not slower", never as "faster").
- **Sequential, not randomised.** Variants of one batch ran back to back with warm-up, but the order was not randomised and thermal/cache state drifts. The cold-start effect (~30 %) shows state matters.
- **Seed-fixed text.** With fixed seeds, acceptance rates repeat exactly between passes; the speeds do not. A fixed seed also means a *single sample path* per cell: acceptance on other texts can differ.
- **Memory placement confounded some early comparisons** (shared vs dedicated GPU memory, [doc 01](01-hardware-and-software.md) §4); relative changes were consistent between placements, absolute values were not.
- **Concurrency.** Other clients on the server during a measurement would distort it; the checks were server-counter based and not exhaustive for every early batch.

## 3. Construct validity (does tok/s mean "faster agent"?)

- The workloads are **synthetic proxies** of agent behaviour (copy, edit, edit-tool call, reasoning). They are not end-to-end task completion times. The gain for a real task depends on **how much of its output repeats the context** (a profile that was measured *before* the tuning: [doc 03](03-speculative-decoding.md) §2) — a workload of free-form writing sees almost none of the `ngram-mod` gain.
- The code in our runs was TypeScript. Other languages or formats (prose, JSON, tables) change the repetition structure.
- The **quality batteries are tiny** (10 + 8 problems, one run per setting; one problem = 12.5 points on the hard set). They are guard rails against "faster but broken", not a model evaluation. **Long-horizon tool-using tasks were not measured here.**
- `repeat-penalty 1.0` was checked on those batteries only; a reasoning loop in a case they do not cover is possible.
- The "Medium is the sweet spot" result is for Qwen3.6 (with a same-architecture fine-tune as a cross-check). For Qwen3.8 the levels were verified to *work* (HTTP 200, mapping), not benchmarked for accuracy.
- The **quality comparison between the two models is a third party's** (Artificial Analysis Intelligence Index v4.3.2, as read on 2026-10-24). It was not reproduced.

## 4. Never measured

Linux/ROCm; CUDA-only; contexts beyond ~200K tokens on Qwen3.8 and a 262,144 window for it; `--parallel` > 1 and unified-KV behaviour; `--checkpoint-min-step` other than 8,192; speed with the vision projector in use; power draw, temperature and the OS power plan; the effect of the vision projector on cache sizes; a long-term field measurement of acceptance after the change (the acceptance rate of 77.3 % is from *before* it); sampling variants other than those listed.

## 5. What is published and what is not

- Published: every number used in tables and figures, and the single observations quoted in the prose ([`data/`](../../data/), with setup and provenance per file), the configuration files, the benchmarks, the figure generator and the header tool. Hardware facts (BIOS date, driver version, memory sizes) come from the system information and the server's start-up log and are not repeated in `data/`.
- **Not published**: raw server logs and per-request outputs, because the prompts of the original runs contained fragments of a private code base. The bundled benchmarks use synthetic fragments so that the *method* can be repeated by anyone, but their absolute numbers will not match ours exactly.
- The numbers were transcribed from internal measurement reports into `data/*.json`; the figures are generated from those files, so a typo in a table can be checked against the JSON.

## 6. How to read a claim in this repository

1. Find the **data file** and the **setup** line of the table.
2. Check whether the effect is bigger than the noise of [doc 02](02-methodology.md) §4.
3. Check whether it was **replicated** (the text says so) or is a single batch.
4. Re-measure on your hardware with [`bench/`](../../bench/) before adopting it.

Corrections and independent reproductions are welcome (see [CONTRIBUTING](../../CONTRIBUTING.md)).
