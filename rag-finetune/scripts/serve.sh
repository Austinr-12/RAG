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
# Why: WSL appends the Windows PATH, which contains an unreadable systemprofile
# folder. Python then raises PermissionError instead of FileNotFoundError when
# a tool such as nvcc is missing, and torch inductor crashes on it. Keep only
# Linux entries.
export PATH="$(IFS=:; for d in $PATH; do [[ $d == /mnt/* ]] || printf '%s:' "$d"; done)"
export PATH="${PATH%:}"
# Why: vLLM 0.31 picks FlashInfer for top-k/top-p sampling and JIT-compiles it
# with nvcc. There is no CUDA toolkit in WSL (only the driver), and the pip
# nvcc (13.4) does not match the pip toolkit headers (13.0). The PyTorch
# sampler is used instead; torch.compile and CUDA graphs are unaffected.
export VLLM_USE_FLASHINFER_SAMPLER=0
VENV="${VENV:-$HOME/.venvs/ragft}"
exec "$VENV/bin/vllm" serve "$MODEL" \
  --served-model-name rag-grounded \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90 \
  --max-num-seqs 4 \
  --api-key "${VLLM_API_KEY:-dev}" \
  --port 8000 \
  "$@"
