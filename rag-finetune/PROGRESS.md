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
