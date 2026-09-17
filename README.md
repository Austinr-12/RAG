# RAG Knowledge Base

A self-hosted retrieval-augmented Q&A app: upload your PDFs / text / markdown, ask questions in plain English, get **cited** answers that quote the exact chunks they were grounded in — no hallucinated sources, no black box.

**Stack:** Next.js 16 (App Router, Turbopack) · TypeScript · Postgres + pgvector on Supabase · Prisma 7 · Clerk auth · OpenAI (`text-embedding-3-small` + `gpt-4o-mini`) · Vercel AI SDK v7 · Tailwind 4.

## What's in this repo

| Folder | What it is | Start here |
|---|---|---|
| [`rag-knowledge-base/`](./rag-knowledge-base) | The app: ingestion, hybrid retrieval, cited streaming chat, evals, security hardening | [`rag-knowledge-base/README.md`](./rag-knowledge-base/README.md) — features, setup, repo layout, security posture, learn-log |
| [`rag-finetune/`](./rag-finetune) | In progress: fine-tuning a small open-weight model (QLoRA) to replace `gpt-4o-mini` as the grounded-answer generator | [`rag-finetune/PLAN.md`](./rag-finetune/PLAN.md) — the integration-checked plan and current status |

The two halves meet at one file: [`rag-knowledge-base/contract/prompt-contract.json`](./rag-knowledge-base/contract/prompt-contract.json). The app generates it from its own prompt, citation and sampling code; the fine-tuning pipeline reads it instead of re-implementing any of it. Tests on both sides fail if it drifts, so a trained model can't silently stop matching the app.

---

## What makes this more than a demo

Most "chat your PDFs" tutorials stop at dense vector similarity → LLM. This project ships the parts that make retrieval quality **measurable and defensible**:

- **Hybrid retrieval** — dense vector search (pgvector) fused with Postgres full-text (`ts_rank_cd`) via [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf). Catches both semantic paraphrase and rare lexical matches (SKUs, phone numbers, model codes).
- **Eval harness with real metrics** — 12-question fixture derived from an included test doc, scored with **hit@K + MRR + mean top-1 similarity**. Every retrieval change gets a before/after table (see [`eval-results.md`](./rag-knowledge-base/eval-results.md)). A second harness runs the production answer path and verifies every citation.
- **Cited answers** — the model outputs Markdown blockquotes in a strict format the UI renders as styled citation cards. Answers that can't be sourced explicitly refuse ("I don't have that in your documents") rather than hallucinate. The format is an executable spec: each citation can be checked for a real document name and a verbatim quote.
- **Swappable answer model** — the generator is chosen by env. Unset, it's `gpt-4o-mini`; point `CHAT_BASE_URL` at any OpenAI-compatible server (vLLM, etc.) and the same route, prompt and UI run on a self-hosted model.
- **Multi-tenant safe by construction** — every query, insert, and delete scopes by `userId`.
- **Deploy-ready even without deploying** — env-driven Upstash swap for rate limiting, cascade-safe deletes, structured migrations, sanitized error responses, [credential rotation guide](./rag-knowledge-base/CREDENTIALS.md).

## Current retrieval quality

Measured against the 12-question Aurora fixture, K=5:

| Strategy | hit@5 | MRR | mean top-1 sim |
|---|---|---|---|
| Dense-only (baseline) | 0.917 | 0.861 | 0.537 |
| **Hybrid RRF (production)** | **1.000** | **0.944** | 0.531 |

Hybrid closes the one dense-only miss (question mentioned words that never appear in the target chunk) and promotes another borderline hit from rank #3 → #1. Full per-question breakdown in [`eval-results.md`](./rag-knowledge-base/eval-results.md).

---

## Architecture

```
┌─────────────────┐    upload     ┌──────────────────────────────────────┐
│  Browser (User) │  ────────▶    │  /api/documents/upload               │
│  drag & drop    │               │  ├─ auth (Clerk) + rate limit       │
└─────────────────┘               │  ├─ pdf-parse | utf8 → text         │
                                  │  ├─ recursive chunker (1000/200)    │
                                  │  ├─ OpenAI embeddings (batched 100) │
                                  │  └─ transactional INSERT with vector│
                                  └──────────────┬───────────────────────┘
                                                 ▼
                                        ┌────────────────┐
                                        │  Postgres +    │
                                        │  pgvector      │
                                        │  (Supabase)    │
                                        └────────┬───────┘
                                                 ▲
┌─────────────────┐    question   ┌──────────────┴───────────────────────┐
│  Chat panel     │  ────────▶    │  /api/chat                           │
│  (streaming)    │               │  ├─ auth + rate limit                │
│                 │  ◀──stream─── │  ├─ embed query                      │
└─────────────────┘               │  ├─ hybrid retrieve (dense + BM25    │
                                  │  │   → RRF k=60)                     │
                                  │  ├─ build prompt with numbered srcs  │
                                  │  ├─ streamText(env-selected model)   │
                                  │  └─ onFinish → persist turn to DB    │
                                  └──────────────────────────────────────┘
```

The retriever interface is a `(userId, query, k) → chunks` function — the same signature is passed to both the chat route and the eval harness, so any new strategy can be A/B'd on the same fixture without touching call sites.

---

## Quick start

```powershell
git clone <this repo>
cd RAG/rag-knowledge-base
npm install
cp .env.example .env   # then fill it in — see CREDENTIALS.md
npx prisma migrate deploy
npm run dev
```

Full setup, the eval commands, the model switch and the prompt contract are documented in [`rag-knowledge-base/README.md`](./rag-knowledge-base/README.md).

---

Built as a portfolio project to demonstrate depth in retrieval-augmented systems, security-conscious API design, and measurable iteration. Feedback welcome.
