#!/usr/bin/env bash
# Qwen3.8-27B (dense) as a single-model llama-server (no router). Same options as the [qwen3.8-27b] section of models.example.ini.
# Adapt MODEL_DIR and the device. NOTE the cache settings: cache-ram 4096 with 32 checkpoints cannot even save a 65K-token chat for this model
# (docs/en/04-prompt-cache-context-compaction.md); 8192 / 8 can. A 262,144 window would need about 12,288.
set -euo pipefail
MODEL_DIR="${MODEL_DIR:-/models}"
exec llama-server \
  -m "$MODEL_DIR/Qwen3.8-27B-Q4_K_M.gguf" \
  --mmproj "$MODEL_DIR/mmproj-Qwen3.8-27B-BF16.gguf" --image-max-tokens 1024 \
  --alias qwen3.8-27b \
  -c 131072 -np 1 -ngl 999 -fa on \
  -ctk q8_0 -ctv q8_0 -b 2048 -ub 1024 \
  --spec-type draft-mtp,ngram-mod --spec-draft-n-max 2 \
  -cram 8192 -ctxcp 8 \
  --temp 1.0 --top-p 0.95 --top-k 20 --min-p 0 --repeat-penalty 1.0 \
  --jinja --reasoning-format deepseek --reasoning on --reasoning-effort medium --reasoning-budget 8192 \
  --metrics --host 127.0.0.1 --port "${PORT:-8080}" ${API_KEY:+--api-key "$API_KEY"}
