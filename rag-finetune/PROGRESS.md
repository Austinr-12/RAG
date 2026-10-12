# rag-finetune progress log

Running log of what has been done, in order, so any future session can pick up
without re-deriving state. Newest entries at the bottom. The plan itself and
the current status block live in `PLAN.md`; this file is the step-by-step
record. Update this file whenever a step finishes, succeeds or fails.

Conventions:
- Each entry: date, what was done, exact commands or files, outcome, and what
  it unblocks. Failures are logged too, with the fix.
- Windows paths use backslashes, Ubuntu paths use forward slashes.
- Secrets never go here. Only names of env vars.

## Where things live

| Thing | Location |
|---|---|
| Code (git-tracked, edited from Windows) | `C:\dev\RAG\rag-finetune` = `/mnt/c/dev/RAG/rag-finetune` in Ubuntu |
| Ubuntu distro disk image | `D:\wsl\Ubuntu\ext4.vhdx` (moved from C: on 2026-10-11) |
| WSL global config | `C:\Users\austi\.wslconfig` |
| Python venv | `~/.venvs/ragft` in Ubuntu (Linux filesystem, not /mnt/c) |
| Hugging Face cache | `~/hf` in Ubuntu (`HF_HOME`) |
| Secrets | `rag-finetune/.env` (gitignored): `HF_TOKEN`, `WANDB_API_KEY`, `OPENAI_API_KEY` |
| App contract file | `../rag-knowledge-base/contract/prompt-contract.json` |

## Log

### 2026-10-11 — Phase 0 kickoff

- Machine audit done, findings and the start sequence written into the
  `PLAN.md` status block. Summary: WSL 2.7.14 + Ubuntu 26.04.1 present and
  fresh; GPU visible inside WSL; Ubuntu Python 3.14 (unsupported by vLLM);
  WSL RAM capped at 7 GB; distro vhdx on C: with 44 GB free; OpenAI still
  `429 credit_balance_exhausted`.
- Base model decision re-verified: Qwen3-4B-Instruct-2507 headline,
  Qwen3-1.7B (thinking off) for ablations. Qwen3.5-4B rejected for now
  (needs transformers/vLLM from main, has a vision encoder).
- **Step 1 done (Windows side).** `wsl --manage Ubuntu --move D:\wsl\Ubuntu`
  moved the 1.4 GB distro image off C:. Wrote `C:\Users\austi\.wslconfig`
  (memory 10GB, swap 24GB at `D:\wsl\swap.vhdx`, localhostForwarding). After
  `wsl --shutdown`, Ubuntu shows 10 GB RAM, 24 GB swap, 955 GB free on `/`,
  user `austin`, GPU visible.
- Scaffolding written: `pyproject.toml` (package `ragft`, Python 3.12,
  deps), `.env.example`, `.gitattributes` (LF for .sh/.py), and
  `scripts/setup-ubuntu.sh` (idempotent env setup, `--system` part as root).
- **Step 2 done (Ubuntu user env).** `scripts/setup-ubuntu.sh --system` as
  root installed gcc 15.2, git 2.53, curl. The user part installed uv 0.13.0,
  CPython 3.12.15, venv at `~/.venvs/ragft`, `HF_HOME=~/hf`, and the `ragft`
  alias in `~/.bashrc`.
- **Step 3 started (background).** `uv pip install vllm` then `-e .` then
  `uv pip freeze > requirements.lock.txt`, log at `~/install.log` in Ubuntu
  (ends with `INSTALL_OK` or `INSTALL_FAILED`). Model downloads
  Qwen/Qwen3-4B-Instruct-2507 and Qwen/Qwen3-1.7B into `~/hf`, log at
  `~/download.log` (ends with `DL_OK` or `DL_FAILED`).
- **Step 3 relaunched correctly.** First attempt never started: PowerShell
  expands `$HOME` inside double-quoted strings before Ubuntu sees the command.
  Lesson: put background work in a script file and launch it with
  `wsl.exe -d Ubuntu -- bash -c 'setsid nohup bash <script> > ~/x.log 2>&1 < /dev/null &'`
  from Git Bash (single quotes). Scripts: `scripts/install-deps.sh` (log
  `~/install.log`, ends `INSTALL_OK`/`INSTALL_FAILED`, also prints installed
  versions and freezes `requirements.lock.txt`) and
  `scripts/download-models.sh` (log `~/download.log`, ends `DL_OK`/`DL_FAILED`).
  vLLM 0.31 pulled the CUDA 13 torch stack (`nvidia-cudnn-cu13`), which the
  616.92 driver (CUDA 13.4) supports.
- Code written for Phase 0 steps 5 and 6: `ragft/client.py` (the single
  OpenAI-compatible streaming client with contract sampling and TTFT),
  `scripts/serve.sh` (vLLM flags for the 3060), `scripts/smoke_serve.py`
  (golden prompts through the served model, citation-scanned, exit 1 on
  failure), `scripts/smoke_train.py` (4-bit load, template print, masked-label
  proof, 50-step throughput and peak VRAM, summary JSON, W&B optional).
  None of these have run yet; they wait on the install.
- **Step 4 half done.** `tests/test_contract.py` passes on the Ubuntu venv
  Python 3.12 (5 tests, contract sha256 `943f4e1c…`). The three new Python
  files compile. `scripts/check-env.sh` added as the start-of-session health
  check (contract test, compile, installed stack, GPU, HF cache). The
  `torch.cuda` check waits on the install.
- Qwen/Qwen3-4B-Instruct-2507 downloaded (7.6 GB in `~/hf/hub`), Qwen3-1.7B in
  progress.
- Lesson for ad-hoc Ubuntu commands from this harness: Git Bash mangles
  `$VAR` inside `wsl.exe -- bash -c '...'`; use PowerShell with a
  single-quoted string instead, e.g.
  `wsl -d Ubuntu -- bash -c 'source ~/.venvs/ragft/bin/activate; python ...'`.
