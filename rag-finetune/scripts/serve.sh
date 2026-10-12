#!/usr/bin/env bash
# Serve a model on the local RTX 3060 the way Phase 0, 2 and 5 expect it.
#
#   bash scripts/serve.sh                                  # base model
#   bash scripts/serve.sh outputs/merged/rag-grounded-v1   # a merged fine-tune
#   VLLM_API_KEY=secret bash scripts/serve.sh Qwen/Qwen3-4B-Instruct-2507 --port 8001
#
# Flags: 8k context keeps the KV cache inside 12 GB next to 8 GB of bf16
# weights; 4 concurrent sequences is plenty for one app and the eval scripts.
# The served name is fixed so the app's CHAT_MODEL_ID never changes.
set -euo pipefail
MODEL="${1:-Qwen/Qwen3-4B-Instruct-2507}"
shift || true
export HF_HOME="${HF_HOME:-$HOME/hf}"
VENV="${VENV:-$HOME/.venvs/ragft}"
exec "$VENV/bin/vllm" serve "$MODEL" \
  --served-model-name rag-grounded \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90 \
  --max-num-seqs 4 \
  --api-key "${VLLM_API_KEY:-dev}" \
  --port 8000 \
  "$@"
