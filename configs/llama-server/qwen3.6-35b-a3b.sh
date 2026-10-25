#!/usr/bin/env bash
# Qwen3.6-35B-A3B as a single-model llama-server (no router). Same options as the [qwen3.6] section of models.example.ini.
# Adapt MODEL_DIR and the device. See docs/en/06-recipes.md for the reason of every option.
set -euo pipefail
MODEL_DIR="${MODEL_DIR:-/models}"
exec llama-server \
  -m "$MODEL_DIR/Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf" \
  --mmproj "$MODEL_DIR/mmproj-Qwen_Qwen3.6-35B-A3B-f16.gguf" --image-max-tokens 1024 \
  --alias qwen3.6 \
  -c 262144 -np 1 -ngl 999 -fa on \
  -ctk q8_0 -ctv q8_0 -b 2048 -ub 1024 \
  --spec-type draft-mtp,ngram-mod --spec-draft-n-max 2 \
  -cram 8192 -ctxcp 32 \
  --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0 --repeat-penalty 1.0 \
  --jinja --reasoning-format deepseek --reasoning on --reasoning-budget 8192 \
  --reasoning-budget-message "Stop thinking: act now." \
  --metrics --host 127.0.0.1 --port "${PORT:-8080}" ${API_KEY:+--api-key "$API_KEY"}
