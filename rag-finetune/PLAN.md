# Grounded-answer fine-tune for RAG: integration-checked plan

Checked against `rag-knowledge-base` at commit `0602a12` on 2026-09-16.
Every "code reality" claim below was read from the repo or from the installed
packages in `node_modules`, not assumed.

## Status (updated 2026-10-11)

The app-side prep in section 8 is **done** and verified (2026-09-16): provider
switch, pinned sampling, citation spec, prompt contract with guards on both
sides, corpus export, generation eval script, Aurora fixture restored. Since
then: Supabase DB password rotated 2026-09-21, WSL2 and Ubuntu installed.

Machine state checked on 2026-10-11:

- WSL 2.7.14 with Ubuntu 26.04.1 LTS registered, fresh and stopped. The
  RTX 3060 12 GB is visible inside Ubuntu. Host driver 616.92 reports CUDA
  13.4, so cu128 and cu130 wheels both work. Never install a Linux NVIDIA
  driver inside WSL.
- Ubuntu's Python is 3.14. vLLM 0.31 supports 3.10 to 3.13 and recommends
  3.12, so the venv uses a uv-managed 3.12.
- WSL sees 7 GB of the 15.8 GB host RAM. Needs `%USERPROFILE%\.wslconfig`
  with memory 10 GB and a 24 GB swap file on D:.
- The distro's disk image is on C:, which has 44 GB free. D: has 825 GB free.
  Move the distro first: `wsl --shutdown` then
  `wsl --manage Ubuntu --move D:\wsl\Ubuntu`.
- OpenAI: still `429 credit_balance_exhausted` on a live check today. This
  blocks the HNSW eval gate, the gpt-4o-mini baseline, OpenAI-teacher
  generation and in-app embeddings. It does not block Phase 0 or
  `npm run export:corpus`, which needs no network.

Base model, re-verified 2026-10-11: Qwen3.5-4B has shipped under Apache 2.0,
but it is a new hybrid architecture with a vision encoder and needs
transformers and vLLM from `main`. It fails the "stable vLLM + TRL +
bitsandbytes" item of the section 5 checklist. The headline base stays
**Qwen3-4B-Instruct-2507** (text-only, non-thinking). Ablation sibling:
Qwen3-1.7B with `enable_thinking=false` baked into the training template,
fallback Qwen2.5-1.5B-Instruct. Re-check Qwen3.5-4B only if a stable vLLM
release lists it before Phase 3 starts.

### Phase 0 start sequence

**Progress 2026-10-12:** steps 1 to 6 are done (see `PROGRESS.md` for the
record). Step 7 waits for the Supabase project to be restored. Measured on
the RTX 3060: vLLM serves the 4B in bf16 at 10.9 GB with torch.compile and
CUDA graphs (FlashInfer sampler off, no CUDA toolkit in WSL); QLoRA r=16
trains the 4B at about 600 tokens/s (3.4 GB peak) and the 1.7B at about
1,300 tokens/s (1.8 GB peak). A 3,000-example epoch is about 2.8 h on the
4B; 1,000-example ablations are about 25 min per epoch on the 1.7B. Zero-shot
base model on the golden prompts: 1 of 2 answerable prompts cited validly,
the other fabricated a quote; gpt-4o-mini: 1 of 2, the other wrapped quotes
in quotation marks. Results in `results/smoke/`.


1. Windows: move the distro to D:, write `.wslconfig`, `wsl --shutdown`,
   confirm `free -g` inside Ubuntu shows about 10 GB.
2. Ubuntu: `apt` build tools, `uv`, Python 3.12. Venv at `~/.venvs/ragft` and
   `HF_HOME=~/hf` on the Linux filesystem, because `/mnt/c` is slow. The code
   stays in `/mnt/c/dev/RAG/rag-finetune` so the Windows IDE and git keep
   working.
3. `pyproject.toml` in `rag-finetune`: install `vllm` first (it pins torch),
   then trl, peft, bitsandbytes, datasets, accelerate, wandb,
   huggingface_hub, rank-bm25, openai, pytest. FlashAttention 2 is optional;
   start with SDPA.
4. Run `tests/test_contract.py` from the venv, plus a `torch.cuda` check.
5. `ragft/client.py`: the one OpenAI-compatible chat client every later eval
   uses. Prove it against
   `vllm serve Qwen/Qwen3-4B-Instruct-2507 --served-model-name rag-grounded
   --max-model-len 8192 --gpu-memory-utilization 0.9 --max-num-seqs 4
   --api-key dev` by streaming a contract golden prompt through it. The reply
   must pass `scan_citations`.
6. `ragft/smoke_train.py`: 4-bit load, chat template printed, 50 SFT steps
   with completion-only loss, one batch of masked labels printed, tokens per
   second and peak VRAM logged to W&B. Run on the 4B and the 1.7B.
7. When OpenAI credits land: `npm run eval` (HNSW gate, expect hybrid
   1.000 / 0.944), then the in-app end-to-end check with `CHAT_BASE_URL`
   pointing at vLLM.

**Revised Phase 0 exit:** contract test green on Linux; the base model served
on the 3060 answers a contract golden prompt with a valid citation through
`ragft/client.py`; a smoke training run is logged. Item 7 completes the
original exit the day credits arrive.

**Needs the user (updated 2026-10-12):** OpenAI credits, HF token and W&B key
are now in place. New blocker: the Supabase project is paused or gone (both
pooler URLs answer `tenant not found`). Restore it in the Supabase dashboard;
until then the HNSW gate, `npm run eval:generation` and the in-app check
cannot run.

**Timeline:** Phase 0 runs 2026-10-11 to 10-14. Starting Phase 1 corpus
collection in parallel (it needs no API) keeps the finish near 2026-11-20.
The original first-half-of-November target needs Phases 1 and 2 compressed.

## 1. Verdict

The idea fits the app. There is exactly one generation call site, the prompt is
a pure module, the citation format and refusal rule already exist, and the app
has no generation eval today (only retrieval hit@5 / MRR). The fine-tune fills a
real gap.

The original plan does not merge cleanly as written. The scan found 17
mismatches plus one hard blocker: the OpenAI account has no credits, so Phase 1
cannot start today. Of the 17, three break the integration outright and nine
would quietly corrupt the training signal or the eval numbers. All are fixable,
and the fixes are folded into the phases in section 7.

## 2. What the scan confirmed

| Plan assumption | Status | Evidence |
|---|---|---|
| One place to swap the model | True | `src/app/api/chat/route.ts:162`, `streamText({ model: openai(CHAT_MODEL), system: SYSTEM_PROMPT, messages })` |
| Citation format `> **Doc** — quote` | True | `src/lib/rag/prompt.ts:22`, quote capped at 200 chars |
| Chunking 1000 / 200 | True | `src/lib/rag/chunking.ts:1-2` |
| Refusal behavior is specified | True | System prompt rules 1 and 5 |
| `gpt-4o-mini` still served | True | Models endpoint returned 200 today |
| OpenAI integration is usable now | **False** | Chat call returned 429 `credit_balance_exhausted` today |
| App is in production | **False** | README: "Not yet deployed publicly" |

One finding changes the GPU plan: this machine has an **RTX 3060 12 GB**. It is
Ampere, so it supports bf16 and FlashAttention 2, and it has no session limits.
A Colab or Kaggle T4 has neither bf16 nor FlashAttention 2.

## 3. Mismatches between the plan and the code

### Breaks the integration

| # | Plan says | Code reality | Fix |
|---|---|---|---|
| 1 | Point the AI SDK OpenAI provider at a `/v1/chat/completions` endpoint | In `@ai-sdk/openai` 4.0.43, `openai(id)` calls the **Responses API** (`/v1/responses`). The installed docs say so explicitly. A chat-completions-only server returns 404. | Build the model with `createOpenAI({ baseURL, apiKey }).chat(id)` |
| 2 | Switch "via env var" | `OPENAI_BASE_URL` is read by both `@ai-sdk/openai` and the `openai` SDK that does embeddings (`src/lib/openai.ts`). Setting it sends embedding calls to vLLM, and retrieval dies. | Use dedicated `CHAT_BASE_URL`, `CHAT_API_KEY`, `CHAT_MODEL_ID`. Never set `OPENAI_BASE_URL`. |
| 3 | Pick any current small instruct model | Many current small models are hybrid thinking models. The route persists raw `text` in `onFinish` and the UI renders text only, so `<think>` blocks leak into the bubble and the database. | Choose a non-thinking instruct variant, or hard-disable thinking in the chat template for both training and serving |

### Corrupts training data or eval numbers

| # | Plan says | Code reality | Fix |
|---|---|---|---|
| 4 | Verbatim check is a string match against the context | `buildRetrievalPrompt` collapses all whitespace (`prompt.ts:53`). The model never sees raw chunk text. | Match quotes against the **rendered prompt text**, per document |
| 5 | Port the TS chunker to Python | The chunker drops separators and rejoins with a space, so long paragraphs lose their `". "` boundaries. It counts UTF-16 units. PDFs also pass through `pdf-parse`. A port will drift. | Do not port. Build the corpus with the app's own `extractText` + `chunkText` from a `tsx` script |
| 6 | Negatives are "question + wrong context" | Hybrid retrieval has no similarity threshold. Any user with documents always gets 5 chunks. The zero-chunk first turn never reaches the model (`route.ts:110`). | Hard negatives: 5 plausible chunks from the same library, with the gold chunk **and its overlapping neighbors** removed |
| 7 | Single-turn examples | Prod sends up to 40 messages / 64k chars of history. Only the last user turn carries sources. Earlier assistant turns hold citations whose sources are gone. | Add multi-turn examples built with the same logic, and cap history for the small model |
| 8 | Doc names are titles | Doc names are **filenames** (`ingest.ts:62`), like `aurora-notebook-handbook.md` | Mix filename-style and title-style names in training |
| 9 | Eval uses its own sampling settings | The route sets no temperature and no output cap. OpenAI defaults to 1.0. vLLM uses the model's `generation_config`. A looping small model runs until `maxDuration = 60`. | Fix `temperature` and `maxOutputTokens` in the route, and use the same values in every eval |
| 10 | gpt-4o-mini is teacher, judge and baseline | The judge grades its own answers and its own references. | Use a different, stronger judge for correctness, validated on 50 hand labels |
| 11 | Split 90/5/5 | Splitting by example leaks chunks from one document into train and test | Split by document library |
| 12 | Product manuals in the corpus | The dataset embeds verbatim text and goes on the HF Hub. Product manuals are copyrighted. | Use only public-domain or permissively licensed sources |

### Overclaims

| # | Plan says | Reality | Fix |
|---|---|---|---|
| 13 | "Swapped into a production RAG app" | No live deployment exists | Deploy, or word the bullet as an env-flag provider switch in a full-stack app |
| 14 | "Cutting per-query cost Z%" | A dedicated GPU only beats gpt-4o-mini at high utilization | Measure saturated throughput, report cost per 1k queries **and** the break-even query rate |

### Tooling

| # | Plan says | Reality | Fix |
|---|---|---|---|
| 15 | "Does your app's citation parser accept it? (regex)" | No parser or regex exists. `MessageBubble.tsx` styles any line starting with `> `. | Define the regex once, in the contract (section 6) |
| 16 | vLLM behind a FastAPI `/v1/chat/completions` endpoint | vLLM already ships an OpenAI-compatible FastAPI server. Re-implementing it is redundant and tends to break SSE streaming. | `vllm serve` plus a thin FastAPI **gateway**: auth, metrics, health, SSE passthrough |
| 17 | Benchmark "in the actual app" | `/api/chat` is behind Clerk and a 200 chats/day limit | Benchmark through a script that reuses the same modules, like `scripts/eval.ts` does |

Local tooling gaps: vLLM needs Linux. WSL2 is not installed, Docker is not
installed, and the only Python is 3.13.

## 4. Blockers to clear before Phase 0

1. **Add OpenAI credits.** About $20 covers generation, judging and baselines.
   This also unblocks the pending `npm run eval` regression gate for the HNSW
   index. Run that gate first so the retrieval baseline is confirmed.
2. **Restore the Aurora fixture.** It was deleted in `6ba562d`, and the README
   still points at `test-fixtures/` and `handoff.md`. It is the best held-out,
   prod-realistic test document.
   ```bash
   mkdir -p rag-knowledge-base/test-fixtures
   git show d7e4848:rag-knowledge-base/test-fixtures/aurora-notebook-handbook.md > rag-knowledge-base/test-fixtures/aurora-notebook-handbook.md
   ```
3. **Rotate the Supabase DB password.** It is still the transcript-exposed one.
   Do it before this repo becomes a resume link.
4. **Install WSL2** (`wsl --install`, reboot), Ubuntu, `uv`, and a Python 3.12
   venv. Keep the HF cache on the Linux side.
5. **Watch disk.** C: has 84 GB free. Budget about 50 GB for the env, two base
   models and the merged model.

## 5. Decisions made (change any of these before starting)

- **Repo layout:** `rag-finetune/` as a sibling folder in this git repo. The
  export scripts and the contract test then live beside the code they guard.
  If a standalone public repo is wanted later, `git subtree split` extracts it.
- **GPU:** local RTX 3060 in WSL2 for training and serving. Kaggle is overflow
  for parallel ablations. One rented hour of an L4 or A10G gives the throughput
  number that the cost claim needs.
- **Base model:** choose at Phase 0 with this checklist: Apache-2.0 or MIT
  license, non-thinking instruct variant, supported by vLLM + TRL +
  bitsandbytes, 8k or more context. As of my knowledge, Qwen3-4B-Instruct-2507
  passes all four. Use a 1.5B to 2B sibling for fast ablations. Verify what is
  current before committing.
- **System prompt:** keep the full `SYSTEM_PROMPT` at inference for the
  fine-tuned model. Every provider then sees identical input, and the
  comparison stays fair.
- **Serving:** `vllm serve` with a thin FastAPI gateway in front.

## 6. The seam: a contract file between the app and the fine-tune

This is what makes the merge safe. The app is the single source of truth, and
the Python side never re-types a prompt.

`npm run export:contract` in the app writes
`rag-knowledge-base/contract/prompt-contract.json`. The app owns the file, so
its guard test never depends on this folder existing. The Python side reads it
through `ragft/contract.py`. It contains:

- `SYSTEM_PROMPT` and `NO_SOURCES_REPLY`, verbatim
- the citation regex: `^> \*\*(.+?)\*\* — (.+)$` with a 200-char quote cap.
  Doc names can themselves contain an em-dash, so the match anchors on the
  closing `**`.
- chunk size, overlap, top-k, temperature, max output tokens
- three golden `(chunks, question) -> rendered prompt` samples
- six golden citation cases with the app's verdict for each citation
- a sha256 of all of the above

Two guards keep it honest, and both are in place:

- A **vitest test** in the app (`src/lib/rag/contract.test.ts`) fails when the
  contract file no longer matches the code. Changing the prompt without
  re-exporting breaks `npm test`.
- A **Python test** (`tests/test_contract.py`, stdlib only) asserts the Python
  prompt renderer and citation checker reproduce every golden sample, and
  `load_contract` refuses a file whose hash does not match its body.

The dataset card and the model card both record the contract hash. A model is
only valid for the app when the hashes match.

## 7. Phases

### Phase 0: setup and seam (3 to 4 days)

- Clear the five blockers in section 4.
- Create `rag-finetune/` with a `.gitignore` for `.venv`, `wandb/`, `outputs/`,
  weights and raw data.
- Write `export-contract.ts` and both contract tests.
- Add the provider switch to the app (section 8) and prove it against **base
  model + vLLM** locally. This de-risks the integration on day 3 instead of
  week 5.
- Load the base model in 4-bit, confirm the chat template, and measure training
  tokens per second on 50 steps. Size the dataset and ablations from that number.

**Exit:** the app streams a cited answer from a local vLLM base model, with
embeddings still going to OpenAI, and `npm test` passes.

### Phase 1: dataset (8 to 10 days)

- **Corpus:** 60 to 100 documents grouped into about 15 "libraries" of 4 to 8
  documents, to mimic one user's uploads. At least 30% real PDFs. Sources:
  Wikipedia (CC BY-SA), US government publications (public domain), and
  permissively licensed project docs.
- **Chunks:** `scripts/export-corpus.ts` runs the app's `extractText` and
  `chunkText` and writes `chunks.jsonl`.
- **Contexts:** simulate retrieval with BM25 inside a library. Shuffle the gold
  chunk position. About 10% of examples get fewer than 5 chunks.
- **Mix, about 3,000 kept examples:**

  | Type | Share |
  |---|---|
  | Answerable, one gold chunk | 60% |
  | Answerable, two gold chunks, often two documents | 10% |
  | Unanswerable hard negatives, canonical abstention | 18% |
  | Partially answerable | 5% |
  | Multi-turn, including uncovered follow-ups and the empty-sources prompt | 7% |

- **Abstention target:** starts with the first sentence of `NO_SOURCES_REPLY`
  so the app has one voice.
- **Filters, each with a logged rejection rate:** regex parses; doc name is in
  the provided set; quote is a substring of that document's rendered text;
  quote is 200 chars or fewer; answerable has at least one citation; abstention
  has none; gold chunk is actually cited; under the max sequence length;
  near-duplicate questions removed; a second teacher call confirms each
  negative is truly unanswerable.
- **Split by library.** Test set is about 300 synthetic held-out examples plus
  an Aurora slice: the 12 existing questions plus about 20 new ones, 8 of them
  unanswerable, hand-checked. Drop Aurora q1 from generation scoring, because
  the system prompt's format example already contains its answer.
- Push to the HF Hub with a dataset card, license CC BY-SA 4.0 if Wikipedia is
  included.

**Exit:** the dataset is on the Hub, filter rejection rates are recorded, and
50 random examples have been read by hand.

### Phase 2: baseline eval (4 to 5 days)

- **One client path.** Every model is called through an OpenAI-compatible chat
  endpoint: vLLM for local models, OpenAI for gpt-4o-mini. Same contract
  sampling settings everywhere. Skip the separate HF `generate` path; it is a
  second chat-template implementation waiting to disagree.
- **Metrics:**
  - format compliance (contract regex)
  - citation precision, strict and lenient, and response-level faithfulness
  - answers with at least one valid citation, and gold-chunk-cited rate
  - abstention precision, recall and over-refusal rate, using one detector for
    all systems: no citation lines plus a cheap LLM check
  - correctness from a judge that is not the teacher, validated on 50 hand labels
  - time to first token and total latency at p50 and p95
  - bootstrap 95% intervals on headline metrics
- Run base zero-shot, base few-shot, and gpt-4o-mini. Record the table.

**Exit:** a frozen "before" table, and judge-versus-human agreement reported.

### Phase 3: training (1 week)

- QLoRA: nf4 with double quantization, bf16 compute, r=16, alpha=32, dropout
  0.05, all linear projections, lr 2e-4 cosine, 3% warmup, effective batch 16,
  max sequence 3072, gradient checkpointing, packing off.
- **Loss on the assistant completion only.** Context is about 85% of tokens.
  Print one batch and confirm the prompt labels are masked. This is the most
  common silent SFT bug.
- Drop over-length examples; never truncate them, since truncation cuts the answer.
- Log loss, per-epoch generation metrics on 100 validation examples, and config
  to W&B. Push adapters to a private Hub repo every epoch.
- **Ablations** on a 1,000-example subset with the small sibling model first:
  LoRA rank 8/16/32, with versus without negatives, 1 versus 3 epochs, with
  versus without multi-turn data. Headline run on the full set.

**Exit:** a headline adapter plus at least four tracked ablation runs.

### Phase 4: eval and analysis (3 to 4 days)

- Merge the adapter into the **bf16** base, not the 4-bit one.
- **Evaluate the artifact that will be served:** the merged model under vLLM.
- Full table: base, fine-tuned, gpt-4o-mini, across every metric, on both the
  synthetic test set and the Aurora slice.
- Read 30 failures and categorize them. Write the W&B report.

**Exit:** final table with intervals, error taxonomy, W&B report link.

### Phase 5: serving and integration (1 week)

- Push the merged model and model card to the Hub.
- `vllm serve` with `--served-model-name`, `--max-model-len 8192` and an API
  key. Add the thin FastAPI gateway and a Dockerfile for it.
- Finish the app changes in section 8.
- **In-app benchmark** with `scripts/eval-generation.ts`: real hybrid
  retrieval, real prompt builder, both providers, JSONL out, scored by the
  Python metrics.
- **Cost:** rent an L4 or A10G for an hour, measure saturated throughput at
  concurrency 1, 4 and 16, then compute cost per 1k queries and the break-even
  query rate against gpt-4o-mini token pricing.
- **Deployment decision:** local demo with a screen recording, or Vercel plus a
  scale-to-zero GPU host. Scale-to-zero cold starts can exceed the route's 60
  second limit, so the public option needs a warm-up ping and a health-checked
  fallback to OpenAI.

**Exit:** the app answers from the fine-tuned model with zero UI changes, and
the latency and cost table is recorded.

### Phase 6: packaging (3 to 4 days)

- A root README indexing both projects. The `rag-finetune` README gets the
  results table, ablation chart and reproduction steps.
- Fix the stale README references in `rag-knowledge-base`.
- Hub links for model, adapter and dataset, each carrying the contract hash.

## 8. App-side change list

| File | Change |
|---|---|
| `src/lib/rag/model.ts` (new) | Provider factory, resolved lazily at request time like `openai.ts` does |
| `src/lib/rag/model.test.ts` (new) | Env switching, and a guard that `OPENAI_BASE_URL` is not used |
| `src/app/api/chat/route.ts` | Use the factory; set `temperature` and `maxOutputTokens` from shared constants |
| `src/lib/chat/sanitize.ts` | Make the history character budget configurable so prompts fit `--max-model-len` |
| `scripts/export-contract.ts`, `export-corpus.ts`, `eval-generation.ts` (new) | The three bridge scripts |
| `src/lib/rag/contract.test.ts` (new) | Fails when the contract file is stale |
| `.env.example`, `CREDENTIALS.md` | Document `CHAT_*`, HF and W&B tokens |
| `prisma/schema.prisma` (optional) | Nullable `Message.model` so answers can be attributed per provider |

The factory, in outline:

```ts
import { createOpenAI, openai } from "@ai-sdk/openai";
import { CHAT_MODEL } from "@/lib/rag/prompt";

export function getChatModel() {
  const baseURL = process.env.CHAT_BASE_URL;
  if (!baseURL) return openai(CHAT_MODEL); // unchanged default path
  const provider = createOpenAI({
    baseURL,
    apiKey: process.env.CHAT_API_KEY ?? "none",
    name: "rag-finetune",
  });
  // .chat() targets /v1/chat/completions. The bare call targets /v1/responses.
  return provider.chat(process.env.CHAT_MODEL_ID ?? "rag-grounded");
}
```

`AGENTS.md` requires reading `node_modules/next/dist/docs/` before touching
Next APIs. These changes stay inside the AI SDK and pure modules.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Student learns to copy the teacher's mistakes | Filters reject unfaithful teacher outputs. The student can then beat the teacher on faithfulness, which is a good result to report. |
| Over-refusal after training on negatives | Track over-refusal on answerable items every epoch; the negatives ablation shows the trade-off |
| Small differences over-read in ablations | Bootstrap intervals; about 300 test items gives roughly plus or minus 5 points |
| 12 GB VRAM is tight for a 4B model in bf16 under vLLM | Cap `--max-model-len`, or serve the small sibling locally and benchmark the 4B on the rented GPU |
| Prompt changes after training | Contract hash mismatch fails the test suite |
| Em-dash or format drift in small models | Format compliance is a first-class metric and a per-epoch signal |

## 10. Budget and timeline

| Item | Cost |
|---|---|
| OpenAI credits: teacher, baseline, judge | about $20 |
| One to two hours of rented L4 or A10G | about $5 |
| Everything else | free |

About 6 to 7 weeks part-time from 2026-09-17, landing in the first half of
November. That is roughly 4 days more than the original, spent on the seam, the
multi-turn data and the judge validation.

## 11. What the resume bullets can honestly say

- Faithfulness and abstention gains: measured against the **same base model
  under the same prompt**, with gpt-4o-mini alongside.
- "Production" only if the app is actually deployed. Otherwise: "integrated
  into a full-stack RAG app behind an env-flag provider switch with zero UI
  changes."
- Cost: "X% lower cost per 1k queries at saturated throughput on an L4, break-even
  at N queries per hour." An unqualified cost claim does not survive an interview.
