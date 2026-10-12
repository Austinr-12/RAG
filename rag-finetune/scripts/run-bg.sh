#!/usr/bin/env bash
# Run a command detached inside the ragft venv, logging to ~/<name>.log and
# appending EXIT=<code> when it finishes. Survives the calling shell closing.
#
#   bash scripts/run-bg.sh smoke4b python scripts/smoke_train.py --no-wandb
#   tail -f ~/smoke4b.log
#
# Loads rag-finetune/.env (HF_TOKEN, WANDB_API_KEY, OPENAI_API_KEY) into the
# environment when present, so CLIs that read env vars work too.
set -uo pipefail
if [[ $# -lt 2 ]]; then echo "usage: run-bg.sh <name> <command...>" >&2; exit 2; fi
NAME="$1"; shift
LOG="$HOME/$NAME.log"
CODE="${CODE:-/mnt/c/dev/RAG/rag-finetune}"
VENV="${VENV:-$HOME/.venvs/ragft}"
export HF_HOME="${HF_HOME:-$HOME/hf}"
export PYTHONUNBUFFERED=1   # stream logs line by line; a killed run still leaves its output
# Why: WSL appends the Windows PATH, which contains an unreadable systemprofile
# folder. Python then raises PermissionError instead of FileNotFoundError when
# a tool such as nvcc is missing, and torch inductor crashes on it. Keep only
# Linux entries.
export PATH="$(IFS=:; for d in $PATH; do [[ $d == /mnt/* ]] || printf '%s:' "$d"; done)"
export PATH="${PATH%:}"
cd "$CODE"
if [[ -f .env ]]; then set -a; source .env 2>/dev/null || true; set +a; fi
: > "$LOG"
setsid nohup bash -c "source '$VENV/bin/activate'; $(printf '%q ' "$@"); echo EXIT=\$?" >> "$LOG" 2>&1 < /dev/null &
echo "started $NAME (pid $!), log $LOG"
