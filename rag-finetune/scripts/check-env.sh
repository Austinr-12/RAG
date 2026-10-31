#!/usr/bin/env bash
# Quick health check of the Ubuntu environment. Run inside Ubuntu:
#
#   bash scripts/check-env.sh
#
# Prints the contract test result, compiles every Python file, and reports the
# installed training/serving stack and GPU. Safe to run at the start of any
# session to see what state the machine is in.
set -uo pipefail
VENV="${VENV:-$HOME/.venvs/ragft}"
CODE="${CODE:-/mnt/d/dev/RAG/rag-finetune}"
export HF_HOME="${HF_HOME:-$HOME/hf}"
cd "$CODE"
PY="$VENV/bin/python"

echo "== python: $($PY --version 2>&1) at $PY"
echo "== contract test"
"$PY" tests/test_contract.py && echo "contract test: OK" || echo "contract test: FAILED"

echo "== compile"
"$PY" -m py_compile ragft/*.py scripts/*.py && echo "compile: OK" || echo "compile: FAILED"

echo "== stack"
"$PY" - <<'PY' 2>&1
import importlib
for name in ("torch", "transformers", "trl", "peft", "bitsandbytes", "datasets", "vllm", "wandb", "openai"):
    try:
        m = importlib.import_module(name)
        print(f"  {name:13s} {getattr(m, '__version__', '?')}")
    except Exception as e:  # noqa: BLE001
        print(f"  {name:13s} MISSING ({type(e).__name__})")
try:
    import torch
    print(f"  cuda available={torch.cuda.is_available()} version={torch.version.cuda} "
          f"device={torch.cuda.get_device_name(0) if torch.cuda.is_available() else '-'}")
except Exception as e:  # noqa: BLE001
    print(f"  torch cuda check failed: {e}")
PY

echo "== hf cache"
du -sh "$HF_HOME" 2>/dev/null || echo "  (none)"
ls "$HF_HOME/hub" 2>/dev/null | sed 's/^/  /'

echo "== memory"
free -g | head -2
nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader 2>/dev/null || echo "  nvidia-smi unavailable"
