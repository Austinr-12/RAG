#!/usr/bin/env bash
# Install the Python dependencies into the ragft venv. Run inside Ubuntu:
#
#   bash scripts/install-deps.sh                      # foreground
#   nohup bash scripts/install-deps.sh > ~/install.log 2>&1 &   # background, log ends with INSTALL_OK / INSTALL_FAILED
#
# vllm goes first because it pins its own torch build; everything else then
# resolves against that torch instead of dragging in a second one. The exact
# resolved set is frozen to requirements.lock.txt for reproducibility.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
VENV="${VENV:-$HOME/.venvs/ragft}"
CODE="${CODE:-/mnt/d/dev/RAG/rag-finetune}"
trap 'echo INSTALL_FAILED' ERR

cd "$CODE"
uv pip install --python "$VENV" vllm
uv pip install --python "$VENV" -e .
uv pip freeze --python "$VENV" > requirements.lock.txt
"$VENV/bin/python" - <<'PY'
import torch, transformers, trl, peft, bitsandbytes, vllm
print("torch", torch.__version__, "cuda", torch.version.cuda, "available", torch.cuda.is_available())
print("transformers", transformers.__version__, "| trl", trl.__version__, "| peft", peft.__version__,
      "| bitsandbytes", bitsandbytes.__version__, "| vllm", vllm.__version__)
PY
echo INSTALL_OK
