#!/usr/bin/env bash
# Download base models into the Hugging Face cache on the Linux filesystem.
#
#   bash scripts/download-models.sh                                   # the two defaults
#   bash scripts/download-models.sh Qwen/Qwen3-4B-Instruct-2507      # any list of repos
#   nohup bash scripts/download-models.sh > ~/download.log 2>&1 &    # log ends with DL_OK / DL_FAILED
#
# Uses the hf CLI through uvx so it works before the venv is finished.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
export HF_HOME="${HF_HOME:-$HOME/hf}"
trap 'echo DL_FAILED' ERR

MODELS=("$@")
if [[ ${#MODELS[@]} -eq 0 ]]; then
  MODELS=("Qwen/Qwen3-4B-Instruct-2507" "Qwen/Qwen3-1.7B")
fi
for m in "${MODELS[@]}"; do
  echo "== $m"
  uvx --from huggingface_hub hf download "$m"
done
du -sh "$HF_HOME"
echo DL_OK
