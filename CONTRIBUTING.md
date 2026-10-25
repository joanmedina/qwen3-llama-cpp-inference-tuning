# Contributing

Corrections, independent reproductions and results from other hardware are the most valuable contributions: this is a one-machine report ([limitations](docs/en/08-limitations.md)), and it gets better every time someone else repeats it. · *Las correcciones, las reproducciones independientes y los resultados de otro hardware son lo más valioso: este informe sale de una sola máquina y mejora cada vez que alguien lo repite.*

## Share a reproduction

1. Run [`bench/spec-bench.mjs`](bench/spec-bench.mjs) (and, if you can, [`bench/cache-bench.mjs`](bench/cache-bench.mjs)) as described in [docs/en/09-reproducing.md](docs/en/09-reproducing.md), one factor at a time, with a warm-up.
2. Open an issue with the **"Reproduction report"** template, or a pull request adding `data/<name>.json`. Always state:
   - hardware (CPU/APU/GPU, memory type and size), OS and driver;
   - backend (Vulkan / ROCm / CUDA / Metal / CPU) and the **llama.cpp build and commit** (`llama-server --version`);
   - the GGUF file (repository, quantisation, **whether `tools/gguf-header.mjs` shows `nextn` tensors**);
   - the exact command line or preset, and which **one** option differs between variants;
   - seeds, repetitions, and how much two identical passes differed (your noise band).
3. Numbers without a setup cannot be used; numbers that contradict ours are welcome — say so plainly.

## Rules for content

- **No private material.** Do not paste prompts, logs or outputs that contain code or data you do not own; the bundled benchmarks use synthetic fragments for that reason.
- **No secrets.** API keys, tokens, internal hostnames and personal paths do not belong in configs, logs or screenshots.
- **Evidence first.** A claim in the documentation points to a data file or to a command that reproduces it; things that were not measured are labelled as such.
- **Both languages.** Documentation changes go in `docs/en/` and `docs/es/` (a translation fix alone is a fine contribution).

## Code

- Node.js ≥ 20, **no dependencies**: the scripts must keep running with a bare `node file.mjs`.
- `node --check` must pass for every `.mjs`; `node tools/check-links.mjs` must report no broken relative link; `node figures/make-figures.mjs` must leave `figures/` unchanged (the figures are generated from `data/`).
- Keep the comments in English and describe *why*, not what.

## Licence

By contributing you agree that your contribution is released under the [MIT licence](LICENSE) of this repository.
