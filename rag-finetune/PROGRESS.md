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
- **Step 3 done.** `~/install.log` ended `INSTALL_OK`. Installed into
  `~/.venvs/ragft` (8.3 GB): torch 2.13.0+cu130 (CUDA available), transformers
  5.17.0, trl 1.15.0, peft 0.21.2, bitsandbytes 0.50.2, vllm 0.31.0, wandb
  0.30.0. Exact set frozen in `requirements.lock.txt`. Both base models are in
  `~/hf/hub` (12 GB total): Qwen3-4B-Instruct-2507 and Qwen3-1.7B.
- Note for the training script: transformers 5.x and TRL 1.x are newer than
  the APIs the plan was written against; `scripts/smoke_train.py` uses the
  TRL 1.x names (`max_length`, `completion_only_loss`, `processing_class`).
  Fix forward if the first run objects.
- `scripts/serve-bg.sh` added: starts vLLM detached, blocks until
  `/v1/models` answers 200 or the log shows a Traceback, `--stop` and
  `--status` subcommands. Log at `~/vllm.log`.
- **GPU contention noted.** At 21:55 the GPU already had 3.2 GB in use by
  Windows: `dwm` 4.6 GB reported by perf counters and a running Steam game
  (GoWEDay, 2.6 GB). Serving the 4B in bf16 needs about 10 GB, so step 5
  (vLLM serve + `smoke_serve.py`) waits for an idle GPU. Step 6 launched
  anyway with `--steps 20` for the template and masking checks; its tokens/s
  is contaminated by the game and must be re-measured on an idle GPU.
  Launched with `scripts/run-bg.sh smoke4b python scripts/smoke_train.py
  --no-wandb --steps 20`, log `~/smoke4b.log`, ends with `EXIT=<code>`.

### 2026-10-11 evening — paused

- The Claude session ended while `smoke4b` was running; WSL shut down with it
  and the detached run died before flushing anything (`~/smoke4b.log` is
  0 bytes). **The training smoke test has not run yet.** Fix applied:
  `scripts/run-bg.sh` now exports `PYTHONUNBUFFERED=1` so partial output
  survives a kill.
- Paused at the user's request (GPU is needed for gaming tonight). WSL shut
  down with `wsl --shutdown`; nothing of ours is running.
- Phase 0 state: steps 1 to 4 done, step 5 (serve + `smoke_serve.py`) and
  step 6 (`smoke_train.py` on 4B and 1.7B) not started, step 7 waits on
  OpenAI credits.

**Resume checklist for tomorrow (idle GPU, nothing else using VRAM):**

1. `wsl -d Ubuntu -- bash /mnt/c/dev/RAG/rag-finetune/scripts/check-env.sh`
   should show the full stack and the GPU with under 1 GB used.
2. Serve: `bash scripts/serve-bg.sh` (prints READY), then
   `source ~/.venvs/ragft/bin/activate && python scripts/smoke_serve.py --json outputs/smoke/serve-base.json`.
   Then `bash scripts/serve-bg.sh --stop` to free VRAM.
3. Train smoke: `bash scripts/run-bg.sh smoke4b python scripts/smoke_train.py --no-wandb`
   (50 steps), wait for `EXIT=0` in `~/smoke4b.log`, read
   `outputs/smoke/Qwen3-4B-Instruct-2507/summary.json`. Then the same with
   `--model Qwen/Qwen3-1.7B --steps 20` as `smoke17b`.
4. If TRL 1.15 rejects an `SFTConfig` field, fix forward in
   `scripts/smoke_train.py` and note the change here.
5. Record tokens/s and peak VRAM in the PLAN.md status block; size Phase 1
   and Phase 3 from them.
6. Still needed from the user: OpenAI credits (about $20), `HF_TOKEN` and
   `WANDB_API_KEY` in `rag-finetune/.env`.
- **Shutdown gotcha, fixed.** `wsl --shutdown` kept being undone within
  seconds. Cause: the three `run_in_background` PowerShell wait loops from the
  earlier session (install, download, smoke4b) outlived that session and kept
  running `wsl -d Ubuntu -- grep ...` every 20 s, which boots the VM. Stopped
  them by PID, then `wsl --shutdown` held. Lesson: before pausing, kill
  leftover wait loops (`Get-CimInstance Win32_Process -Filter "name='powershell.exe'"`
  filtered on `grep -q` + `wsl` in CommandLine), then shut down.

### 2026-10-12 — Phase 0 resumed

- GPU idle at start (0.5 GB used). OpenAI credits live (chat ping HTTP 200).
  `HF_TOKEN`, `WANDB_API_KEY`, `OPENAI_API_KEY` were saved in the app's
  `.env`; copied by name into `rag-finetune/.env` (gitignored). The app's
  copy was left in place.
- **gpt-4o-mini through `ragft.client` works** (`scripts/smoke_serve.py
  --openai --all`, output `outputs/smoke/serve-gpt4omini.json`): 2 of 3
  golden prompts pass. The failure is informative, not a harness bug: on the
  two-document prompt gpt-4o-mini wrapped both quotes in double quotes
  (`— "Every Aurora…"`), so the app's verbatim check marks them invalid.
  Record this as the first baseline observation for Phase 2 (strict vs
  lenient citation precision). TTFT 0.5 to 1.0 s, 1.0 to 1.3 s total.
- `npm run eval` (HNSW gate) failed before reaching OpenAI:
  Supabase pooler answered `tenant/user postgres.<ref> not found`. Diagnosing
  (likely the free-tier project was paused after three idle weeks).
- **Database unreachable, user action needed.** Both `DATABASE_URL` (pooler
  :6543) and `DIRECT_URL` (pooler :5432) return
  `(ENOTFOUND) tenant/user postgres.rcmwbfirmelhbnokqiuu not found` from
  `aws-1-us-west-1.pooler.supabase.com`. That is Supavisor saying the project
  does not exist on that pooler: a free-tier project paused after inactivity
  (last verified 2026-09-21), or deleted. Fix: restore the project in the
  Supabase dashboard, then re-run `npm run eval`. If the project was
  recreated instead, the URLs, password and the Aurora upload all need
  redoing. Blocks: HNSW gate, `npm run eval:generation`, in-app end-to-end
  check (Phase 0 step 7), Phase 5. Does not block Phase 0 GPU steps or
  Phase 1 corpus work.
- **vLLM first start failed** (`~/vllm.log`): weights loaded (9.3 GB on GPU,
  FlashAttention 2 backend chosen), then torch inductor failed during the
  compile phase of memory profiling. The visible exception,
  `PermissionError: [Errno 13] Permission denied: 'nvcc'`, is a red herring:
  there is no nvcc, and Python reports PermissionError instead of
  FileNotFoundError because WSL appends Windows PATH entries that include an
  unreadable `systemprofile` folder. That call happens while inductor writes
  a crash repro, so the primary error is masked. Diagnosing with a minimal
  `torch.compile` test under a PATH without `/mnt/` entries. Fallback if it
  stays broken: `--enforce-eager` for the seam check (no torch.compile, no
  CUDA graphs; latency numbers from that mode are not final).
- Harness lesson (root cause of every quoting failure so far): `wsl.exe --`
  runs the rest of the line through the Linux login shell before `bash -c`
  sees it, so `$VAR`, `$(...)` and inner double quotes get expanded or
  stripped once too often. Ad-hoc diagnostics now go into a script file in
  the scratchpad and run as `wsl.exe -d Ubuntu -- bash /mnt/c/.../script.sh`.
- **vLLM second start, real cause found.** With Windows PATH entries
  stripped, the masked error appeared: FlashInfer's JIT sampler needs
  `nvcc` (`Could not find nvcc and default cuda_home='/usr/local/cuda'
  doesn't exist`). The pip `nvidia-cuda-nvcc` 13.4 exists in the venv but
  FlashInfer's bundled headers are 13.0, so pointing `CUDA_HOME` at it fails
  with "CUDA compiler and CUDA toolkit headers are incompatible". Fix:
  `VLLM_USE_FLASHINFER_SAMPLER=0` in `scripts/serve.sh` (PyTorch sampler;
  torch.compile verified working separately). Later option if another JIT
  needs nvcc: install a matching toolkit (apt or runfile) and set
  `CUDA_HOME`.
- Client defaults switched from `localhost` to `127.0.0.1`
  (`ragft/client.py`, `scripts/smoke_serve.py`, `scripts/serve-bg.sh`): vLLM
  binds IPv4 and Python may resolve localhost to `::1` first.
- **Step 5 DONE: seam proven on the local GPU.** vLLM 0.31 serves
  Qwen3-4B-Instruct-2507 as `rag-grounded` (bf16, 8k context, FlashAttention 2,
  torch.compile + CUDA graphs, PyTorch sampler) using 10.9 GB of the 12 GB.
  Startup from cold: about 3.5 min (1 min imports, 67 s weight load, compile).
  `scripts/smoke_serve.py --all` through `ragft.client` against it
  (`outputs/smoke/serve-base.json`): full-top-k prompt PASS with a verbatim
  citation (TTFT 0.12 s, 1.7 s total); no-sources prompt PASS (abstains, no
  citation); two-documents prompt FAIL because the base model fabricated a
  quote ("Answer: How long is the warranty…") that is not in the source. That
  failure is the training target, not a harness problem. For comparison,
  gpt-4o-mini failed the two-documents prompt differently (quotation marks
  around otherwise verbatim quotes).
- Bug fixed in `scripts/serve-bg.sh --status`: it exited with the status of
  the wrong test and always reported ready. Now exits 1 unless `/v1/models`
  answers 200.
- **Open item for Phase 3 (ablation model).** Qwen3-1.7B's chat template
  renders an empty `<think>\n\n</think>` block inside the assistant turn of a
  training example, while the plain generation prompt ends at
  `<|im_start|>assistant\n` with no block (thinking on by default). Before
  ablations: render training and serving with `enable_thinking=False` on
  both sides (TRL `chat_template_kwargs` if supported, else pre-render), and
  serve with `--chat-template-kwargs '{"enable_thinking": false}'` or
  equivalent. The 4B Instruct-2507 has no think block and needs nothing.
- Session wrap-up 2026-10-12 19:07: no vLLM or training process running,
  GPU back to 0.5 GB. Uncommitted: `PROGRESS.md`, `scripts/serve-bg.sh`,
  `scripts/smoke_train.py`, new `results/smoke/`.

- **Step 6 DONE: training smoke tests pass on both models** (W&B project
  `rag-finetune`, runs `smoke-Qwen3-4B-Instruct-2507-r16-s50` and
  `smoke-Qwen3-1.7B-r16-s20`; summaries copied to `results/smoke/`).
  TRL 1.15 fixes applied in `scripts/smoke_train.py`: `warmup_ratio` →
  `warmup_steps`, `include_tokens_per_second` removed (tokens/s now derived
  from `trainer.state.num_input_tokens_seen`).

  | model | steps × accum | seq tokens | tok/s | peak VRAM | runtime |
  |---|---|---|---|---|---|
  | Qwen3-4B-Instruct-2507 (nf4, r=16) | 50 × 4 | ~1.5k | 598 | 3.4 GB | 485 s |
  | Qwen3-1.7B (nf4, r=16) | 20 × 4 | ~1.5k | 1292 | 1.8 GB | 90 s |

  Masking proof: supervised tokens are exactly the assistant completion
  (4.4% of the toy sequence; real answers will be longer). Loss on the toy
  set fell 2.03 → 0.03, which only shows the pipeline learns.
- **Sizing from these numbers.** 3,000 examples at about 2k tokens each is
  roughly 6M tokens per epoch: about 2.8 h per epoch for the 4B, 3 epochs in
  under 9 h. 1,000-example ablations on the 1.7B are about 25 min per epoch.
  VRAM headroom (8 GB unused) allows per-device batch 2 to 4, which should
  raise throughput; try in Phase 3.
- **Phase 0 exit reached except step 7.** Contract test green on Linux; the
  base model served on the 3060 answers a golden prompt with a valid
  citation through `ragft/client.py`; both smoke training runs logged to
  W&B. Step 7 (HNSW gate, in-app check) waits for the Supabase project.
- **Push blocked by GitHub secret scanning, fixed 2026-10-12.** The commit
  "more training setup" was rejected because
  `results/smoke/serve-gpt-4o-mini.json` contained the real OpenAI key:
  `smoke_serve.py` had written `endpoint.__dict__` into the JSON. Fix:
  the script now records only `model` and `base_url`; the key was stripped
  from the tracked and the `outputs/` copies; the unpushed commit was
  amended (a new commit on top would have left the key in history and the
  push would still fail) and pushed as `0124d42`. The key never reached the
  remote. Rotating it is optional insurance.
  Rule from now on: result files never carry credentials; check with
  `git grep -c -E 'sk-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,}' HEAD` before
  pushing.
- **Security hardening after the push block (2026-10-12).**
  - Leaked commit `5efe88c` purged locally (`git reflog expire` + `gc`);
    it no longer exists anywhere.
  - Whole-history scan for key patterns (OpenAI, HF, AWS, GitHub tokens,
    DB URLs with passwords): the only matches are placeholder database URLs
    in `CREDENTIALS.md` and `.env.example`. No real secret in any commit.
  - `.env` files confirmed untracked and ignored in both projects;
    `outputs/` and `wandb/` ignored.
  - Pre-commit hook added at `.githooks/pre-commit` (repo root) and
    activated with `git config core.hooksPath .githooks`. It refuses any
    staged file containing a key-shaped string and prints a masked hit.
    Tested: fake key refused, clean file passes. On a fresh clone, run the
    `git config` line once.
  - `CREDENTIALS.md` status row updated: OpenAI key rotation recommended.
  - Still the user's call: rotate the OpenAI key (recommended), then update
    both `.env` files. Optional: enable secret scanning alerts in the GitHub
    repo settings so a future leak also notifies by email.
- **OpenAI key rotated by the user 2026-10-12, verified.** New key answers
  200 from both `.env` files (the fine-tune copy was synced from the app's
  file); the old key returns 401. `CREDENTIALS.md` row updated. Pre-commit
  hook committed by the user; `core.hooksPath` is set. Supabase restore
  still pending (their side was having trouble).

### 2026-10-13 — Phase 0 step 7 done, Phase 0 complete

- Supabase project restored by the user. The restore invalidated the DB
  password; the user reset it. Connection still failed with `28P01` because
  the new password contains a literal `%` followed by two hex characters,
  which URL clients decode. Fixed by writing `%` as `%25` in both URLs (the
  rewrite printed only character counts). `CREDENTIALS.md` row updated with
  the rule: percent-encode every password character outside `A-Za-z0-9-._~`.
  Data intact: 1 document, 10 chunks.
- **Retrieval gate passed:** `npm run eval` hybrid-rrf hit@5 1.000, MRR
  0.944, identical to the pre-index baseline. Dense-only 0.917 / 0.861.
- **In-app generation eval, 12 Aurora questions, real hybrid retrieval**
  (`results/phase0/`):

  | provider | format OK | citations verified | replies with a valid cite | median TTFT | median total |
  |---|---|---|---|---|---|
  | gpt-4o-mini | 100% | 0/12 | 0% | 868 ms | 1658 ms |
  | Qwen3-4B-Instruct-2507 base via vLLM | 100% | 3/11 | 25% | 347 ms | 2282 ms |

  Failure modes read from the JSONL: gpt-4o-mini wraps every quote in
  straight double quotes, so the strict verbatim rule fails all of them even
  though the text is exact. The base 4B copies text verbatim but cites the
  wrong document name on many answers (it reuses the title from the system
  prompt's format example instead of the filename), and q1's answer is in
  that example, as the plan predicted. The Windows app reaches the WSL vLLM
  on localhost; the custom provider path works end to end with zero UI
  changes.
- **Decision needed before Phase 1 (user):** should the app's citation
  verifier tolerate one pair of wrapping quotation marks around the quote?
  Recommendation: yes, strip straight or curly wrapping quotes before the
  substring check and re-export the contract. It keeps the comparison honest
  (gpt-4o-mini's quotes are exact) and the fine-tune is still measured on
  the strict rule as a second metric. Nothing is trained yet, so the
  contract hash change costs nothing now and a lot later.
- vLLM stopped; GPU free. Phase 1 (dataset) starts next.

### 2026-10-13 (later) — lenient quote rule, cleanup, corpus start

- **Decision taken: wrapping quotation marks are tolerated.** The app's
  `verifyCitation` now strips one pair of wrapping marks (straight, curly,
  guillemets; list exported as `citation.quoteWrapperPairs`) before the
  substring check; `verbatimStrict` reports the old no-stripping verdict.
  The Python mirror reads the pair list from the contract and reproduces the
  verdicts; a new golden case `quote-wrapped-in-quotation-marks` guards
  both sides. Checks: tsc clean, vitest 95/95, eslint clean, Python 5/5.
  **Contract sha256 changed: `943f4e1c…` → `00e407e9…`.** No dataset or
  model existed under the old hash, so nothing is invalidated.
- `scripts/rescore.py` re-scores any eval-generation JSONL under the current
  contract, no model calls. Phase 0 runs re-scored with q1 excluded (its
  answer is in the system prompt example); table in
  `results/phase0/rescore-lenient-contract.json`:

  | metric | gpt-4o-mini | Qwen3-4B base |
  |---|---|---|
  | citation precision, lenient | 45.5% | 30.0% |
  | citation precision, strict | 0.0% | 30.0% |
  | replies with ≥1 valid citation | 45.5% | 27.3% |
  | format-compliant | 100% | 100% |
  | median TTFT | 773 ms | 347 ms |

  Reading: after allowing quotation marks, gpt-4o-mini's remaining misses
  are wrong document names (title instead of filename) and light
  paraphrases; the base 4B's are mostly wrong names. Both are training
  targets.
- **Cleanup:** removed `rag-knowledge-base/scripts/test-chunker.ts`
  (superseded by `chunking.test.ts`), the untracked generated
  `scripts/fixtures/`, and local `outputs/smoke/` (tracked copies live in
  `results/smoke/`). README tree updated. Kept: `test-extract.ts` (only
  extraction check), `debug-retrieve.ts` (useful one-off), all tracking
  docs. `.gitignore` now keeps `results/**/*.jsonl` so the Phase 0 JSONLs
  are tracked (they were silently ignored before).
- **Phase 1 corpus started.** `data/corpus-manifest.json` lists 16
  libraries / 92 candidate documents with licenses and the selection
  criteria; `scripts/fetch_corpus.py` downloads into `data/raw/` (ignored),
  verifies PDF headers and text cleanliness, and writes
  `data/raw/fetch-report.json`. Sources: IRS, NIST, Copyright Office, SSA,
  OSHA, CFPB/FDIC/FTC/HUD, HHS/NIH, EPA/FEMA, USCIS (all public domain),
  CPython tutorial (PSF), Rust book (MIT/Apache), Django docs (BSD),
  Wikipedia via the extracts API (CC BY-SA 4.0), Project Gutenberg.
