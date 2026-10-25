# 02 · Methodology

[← Hardware and software](01-hardware-and-software.md) · [Index](../../README.md) · [Next: Speculative decoding →](03-speculative-decoding.md)

This page states how the numbers were obtained, what they can and cannot support, and which confounders were found along the way. The aim is that someone with a different machine can repeat the *method* even if the absolute numbers differ ([doc 09](09-reproducing.md)).

## 1. Research questions

1. **Generation speed.** Which `llama-server` speculative-decoding settings maximise tokens/s for the workload of a coding agent (lots of copying and editing of text that is already in the context, plus reasoning)?
2. **Prompt cache and context.** How must the RAM prompt cache and the context checkpoints be sized so that long chats, foreign requests and the agent's context compaction do not force a full re-processing of the history?
3. **Thinking.** How do thinking budgets and the on/off switch trade accuracy for time, and what does a client really send to the server?
4. **Knobs that did not matter.** Do CPU threads, batch sizes, KV-cache type, backend sampling or a second GPU change anything?

## 2. Design: one factor at a time, on a copy of the real configuration

- The production router (`:8080`) was **never modified while measuring**. All variants ran in a *temporary router* on another port (`--models-max 1`), started from a **copy of the production preset in which only the factor under test was changed**. Each variant loaded the model from scratch (no state carried over) and received a warm-up request before measuring.
- The final candidate configuration was validated as a whole (the model loads, answers, and the server shows the new arguments in `/models`) **before** being applied; it was applied with backups, one router restart, and re-measured in production with the same loads. Every change in this repository has an exact revert.
- The starting point of each experiment is the configuration that was in production before it (stated in each table). It was not a default configuration: it already used MTP with 2 draft tokens, a 262,144-token context, `q8_0` KV cache, flash attention and batch sizes 2048/1024.

## 3. Workloads

A coding agent spends most of its time rewriting files and quoting text that is already in its context, interleaved with reasoning and tool calls. Six loads were defined (the repository's [`bench/spec-bench.mjs`](../../bench/spec-bench.mjs) implements the same ones with bundled synthetic code):

| Load | What it asks the model | What it stresses |
|---|---|---|
| `copy` | copy a ~1,400-character code fragment verbatim | best case for n-gram self-speculation |
| `edit` | rewrite the fragment adding a one-line comment above each function | long copied spans with small insertions |
| `edit-tool` | one call to an `edit` tool whose `old_string` must be copied from the context and whose `new_string` contains the change | the realistic agent step |
| `prose` | ~300-word explanation | little to copy; MTP only |
| `agent` | one agent step with tool definitions and bounded reasoning | mixed |
| `reasoning` | free reasoning bounded to a few hundred tokens | nothing to copy: speculative n-grams cannot help |

In our runs the fragments were real source code (TypeScript, three different files); the raw outputs contain that code and are therefore **not published**. The tables and the figures are.

## 3.1 Metrics

| Metric | Definition |
|---|---|
| **TG** | tokens/s of generation, as returned by the server: `timings.predicted_per_second` |
| **PP** | tokens/s of prompt processing (prefill): `timings.prompt_per_second` |
| **Acceptance** | `timings.draft_n_accepted / timings.draft_n`: the share of proposed draft tokens that the target model accepted |
| **Return time** | wall-clock seconds of the request that returns to a long chat after a foreign request took the only slot |
| **Accuracy** | correct answers out of a fixed set of problems with a single checkable answer (only the final content is graded) |
| **Repetition measure** | share of repeated 6-word groups in a response; natural text is 0.05–0.25, a reasoning loop is above 0.5 |

## 4. Seeds, repetitions and what counts as an effect

- Every request used a **fixed sampling seed**; with a fixed seed the *text* is identical across runs, so differences in speed come from the server and the machine, not from different outputs. (Consequence: acceptance rates repeat exactly between passes, speeds do not.)
- Quick batches: 3 fragments × 1 seed. Key claims were **replicated** with 3 fragments × 3 seeds, and production was measured three times.
- **Noise.** On the iGPU alone, two passes of the same configuration differed by **±15–20 %**; the dual-GPU configuration by ±3 %. Differences under about 3 % inside one batch were treated as noise, and a single run is never used to claim a gain under ~15 %. This is why results such as "+15 % faster" for a model swap are reported as "not slower".
- Percentages are relative to the starting point of the same table, computed from unrounded means.

## 5. Confounders found (and handled)

| Confounder | Evidence | Handling |
|---|---|---|
| **Cold machine.** The first measurement after a router restart or a model load is slower | 82.0 tok/s on the first production run vs 112.6 and 113.5 on the next two, with identical text and identical draft acceptance | warm-up request; discard the first run; never measure right after a restart |
| **Memory placement** (dedicated vs shared GPU memory) | 60.3 tok/s in a temporary router vs 70.3 in production for the same starting configuration | compare variants only under the same placement; see [doc 01](01-hardware-and-software.md) §4 |
| **Repeated texts inflate copy/edit** | copy speed of a Qwen3.6 fine-tune with the same architecture: 131 → 168 → 233 tok/s across three repetitions of the same texts, acceptance 81–91 % (the base Qwen3.6 went 118 → 165 → 148, its first run being the cold one) | probably the n-gram pool that the server shares between requests (not verified); vary the texts when comparing, and compare variants back to back |
| **Other clients on the server** | another session used the model during one pass | read the server counters (`/metrics`) before and after each stage; in a later check of another Qwen3.6 variant the production model had `+0` tokens during the speed stages |
| **Client-side timeouts** | a re-processing of ~100K tokens was cut at 300 s by the HTTP client (Node's `fetch`) | use `node:http` or a longer timeout for long requests |

## 6. Quality checks

Two small batteries guard against "faster but worse": 10 *easy* and 8 *hard* problems with one checkable answer (multi-step arithmetic, logic, what a snippet prints, a code bug, a SQL query, schedules, counting, a probability), one run per setting, generation capped at 4,500 tokens. They are **deliberately small and cheap**: with 8 problems, one answer is 12.5 percentage points, so only differences of two or more problems are discussed as such. They do not measure long-horizon agent quality.

## 7. Decision rule

A change was adopted only if (1) its gain was outside the noise band **and replicated**, (2) reasoning-type loads did not regress, (3) the quality batteries were unchanged, and (4) it could be reverted with a one-line command. Changes that failed (1) are listed in [doc 07](07-pitfalls-and-negative-results.md).

## 8. Data and figures

`data/*.json` holds the measured numbers with their setup and provenance; [`figures/make-figures.mjs`](../../figures/make-figures.mjs) regenerates every figure from them (`node figures/make-figures.mjs`). Tables in these pages are transcribed from the same files.
