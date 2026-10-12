#!/usr/bin/env bash
# One-time Ubuntu (WSL2) environment setup for rag-finetune. Idempotent.
#
#   system packages (as root):  wsl -d Ubuntu -u root -- bash scripts/setup-ubuntu.sh --system
#   user environment:           bash scripts/setup-ubuntu.sh
#
# The venv and the Hugging Face cache live on the Linux filesystem because
# /mnt/c is slow for the many small files torch and vLLM ship with. The code
# stays on /mnt/c so the Windows IDE and git keep working.
set -euo pipefail

VENV="$HOME/.venvs/ragft"
CODE="/mnt/c/dev/RAG/rag-finetune"

if [[ "${1:-}" == "--system" ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq build-essential git curl ca-certificates
  exit 0
fi

if [[ ! -x "$HOME/.local/bin/uv" ]] && ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"

uv python install 3.12
[[ -d "$VENV" ]] || uv venv "$VENV" --python 3.12 --seed

mkdir -p "$HOME/hf"
if ! grep -q 'rag-finetune' "$HOME/.bashrc"; then
  cat >> "$HOME/.bashrc" <<'RC'

# rag-finetune
export HF_HOME="$HOME/hf"
export PATH="$HOME/.local/bin:$PATH"
alias ragft='source "$HOME/.venvs/ragft/bin/activate" && cd /mnt/c/dev/RAG/rag-finetune'
RC
fi

echo "uv: $(uv --version)"
echo "python: $("$VENV/bin/python" --version)"
echo "next: source $VENV/bin/activate && uv pip install vllm && uv pip install -e $CODE"
