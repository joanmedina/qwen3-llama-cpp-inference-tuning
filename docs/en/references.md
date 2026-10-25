# References

[← Reproducing](09-reproducing.md) · [Index](../../README.md)

## Methods

1. Leviathan, Y., Kalman, M., Matias, Y. (2023). *Fast Inference from Transformers via Speculative Decoding.* ICML 2023. [arXiv:2211.17192](https://arxiv.org/abs/2211.17192)
2. Chen, C., Borgeaud, S., Irving, G., Lespiau, J.-B., Sifre, L., Jumper, J. (2023). *Accelerating Large Language Model Decoding with Speculative Sampling.* [arXiv:2302.01318](https://arxiv.org/abs/2302.01318)
3. Gloeckle, F., Idrissi, B. Y., Rozière, B., Lopez-Paz, D., Synnaeve, G. (2024). *Better & Faster Large Language Models via Multi-token Prediction.* ICML 2024. [arXiv:2404.19737](https://arxiv.org/abs/2404.19737)
4. DeepSeek-AI (2024). *DeepSeek-V3 Technical Report* (multi-token prediction used for speculative decoding). [arXiv:2412.19437](https://arxiv.org/abs/2412.19437)
5. Yang, S., Kautz, J., Hatamizadeh, A. (2024). *Gated Delta Networks: Improving Mamba2 with Delta Rule.* [arXiv:2412.06464](https://arxiv.org/abs/2412.06464)
6. Saxena, A. (2023). *Prompt Lookup Decoding* (n-gram drafts taken from the prompt). <https://github.com/apoorvumang/prompt-lookup-decoding>

## Software

7. llama.cpp (`llama-server`, build 11721, commit `ff5a23376`). <https://github.com/ggml-org/llama.cpp>. Options discussed here, with their own pointers in `llama-server --help`: `--spec-type`, `--spec-draft-n-max`, `--spec-ngram-mod-*`, `--ctx-checkpoints` ([PR #15293](https://github.com/ggml-org/llama.cpp/pull/15293)), `--cache-ram` ([PR #16391](https://github.com/ggml-org/llama.cpp/pull/16391)), `--reasoning-budget`, `--reasoning-effort`, `--models-preset`.

## Models and third-party measurements

8. Qwen3.6-35B-A3B model card: <https://huggingface.co/Qwen/Qwen3.6-35B-A3B>. GGUF quantisation used: <https://huggingface.co/bartowski/Qwen_Qwen3.6-35B-A3B-GGUF> (Q4_K_M + `mmproj` F16).
9. Qwen3.8-27B model card: <https://huggingface.co/Qwen/Qwen3.8-27B> (sampling and `reasoning_effort` recommendations). GGUF quantisation used: <https://huggingface.co/lmstudio-community/Qwen3.8-27B-GGUF>; reference conversion: <https://huggingface.co/ggml-org/Qwen3.8-27B-GGUF>.
10. Artificial Analysis, *Qwen3.8-27B* model page (Intelligence Index v4.3.2: 34 for Qwen3.8-27B at `xhigh`, 18 for Qwen3.6-35B-A3B; read on 2026-10-24, **not reproduced here**): <https://artificialanalysis.ai/models/qwen3-8-27b>.

## Citing this repository

See [`CITATION.cff`](../../CITATION.cff). Please cite the commit you used: the llama.cpp options and defaults it describes change between builds.
