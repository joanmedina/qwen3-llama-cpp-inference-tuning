# Referencias

[← Reproducir](09-reproducir.md) · [Índice](../../README.es.md)

## Métodos

1. Leviathan, Y., Kalman, M., Matias, Y. (2023). *Fast Inference from Transformers via Speculative Decoding.* ICML 2023. [arXiv:2211.17192](https://arxiv.org/abs/2211.17192)
2. Chen, C., Borgeaud, S., Irving, G., Lespiau, J.-B., Sifre, L., Jumper, J. (2023). *Accelerating Large Language Model Decoding with Speculative Sampling.* [arXiv:2302.01318](https://arxiv.org/abs/2302.01318)
3. Gloeckle, F., Idrissi, B. Y., Rozière, B., Lopez-Paz, D., Synnaeve, G. (2024). *Better & Faster Large Language Models via Multi-token Prediction.* ICML 2024. [arXiv:2404.19737](https://arxiv.org/abs/2404.19737)
4. DeepSeek-AI (2024). *DeepSeek-V3 Technical Report* (predicción de varios tokens usada para la decodificación especulativa). [arXiv:2412.19437](https://arxiv.org/abs/2412.19437)
5. Yang, S., Kautz, J., Hatamizadeh, A. (2024). *Gated Delta Networks: Improving Mamba2 with Delta Rule.* [arXiv:2412.06464](https://arxiv.org/abs/2412.06464)
6. Saxena, A. (2023). *Prompt Lookup Decoding* (borradores de n-gramas tomados del prompt). <https://github.com/apoorvumang/prompt-lookup-decoding>

## Software

7. llama.cpp (`llama-server`, compilación 11721, commit `ff5a23376`). <https://github.com/ggml-org/llama.cpp>. Opciones tratadas aquí, con sus propias referencias en `llama-server --help`: `--spec-type`, `--spec-draft-n-max`, `--spec-ngram-mod-*`, `--ctx-checkpoints` ([PR #15293](https://github.com/ggml-org/llama.cpp/pull/15293)), `--cache-ram` ([PR #16391](https://github.com/ggml-org/llama.cpp/pull/16391)), `--reasoning-budget`, `--reasoning-effort`, `--models-preset`.

## Modelos y mediciones de terceros

8. Ficha del modelo Qwen3.6-35B-A3B: <https://huggingface.co/Qwen/Qwen3.6-35B-A3B>. Cuantización GGUF usada: <https://huggingface.co/bartowski/Qwen_Qwen3.6-35B-A3B-GGUF> (Q4_K_M + `mmproj` F16).
9. Ficha del modelo Qwen3.8-27B: <https://huggingface.co/Qwen/Qwen3.8-27B> (recomendaciones de muestreo y de `reasoning_effort`). Cuantización GGUF usada: <https://huggingface.co/lmstudio-community/Qwen3.8-27B-GGUF>; conversión de referencia: <https://huggingface.co/ggml-org/Qwen3.8-27B-GGUF>.
10. Artificial Analysis, página del modelo *Qwen3.8-27B* (Intelligence Index v4.3.2: 34 para Qwen3.8-27B en `xhigh`, 18 para Qwen3.6-35B-A3B; leído el 2026-10-24, **no reproducido aquí**): <https://artificialanalysis.ai/models/qwen3-8-27b>.

## Cómo citar este repositorio

Véase [`CITATION.cff`](../../CITATION.cff). Cita el commit que usaste: las opciones y los valores por omisión de llama.cpp que describe cambian entre compilaciones.
