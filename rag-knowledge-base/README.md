# RAG Knowledge Base

A self-hosted retrieval-augmented Q&A app: upload your PDFs / text / markdown, ask questions in plain English, get **cited** answers that quote the exact chunks they were grounded in — no hallucinated sources, no black box.

**Stack:** Next.js 16 (App Router, Turbopack) · TypeScript · Postgres + pgvector on Supabase · Prisma 7 · Clerk auth · OpenAI (`text-embedding-3-small` + `gpt-4o-mini`) · Vercel AI SDK v7 · Tailwind 4.

---

## What makes this more than a demo

Most "chat your PDFs" tutorials stop at dense vector similarity → LLM. This project ships the parts that make retrieval quality **measurable and defensible**:

- **Hybrid retrieval** — dense vector search (pgvector) fused with Postgres full-text (`ts_rank_cd`) via [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf). Catches both semantic paraphrase and rare lexical matches (SKUs, phone numbers, model codes).
- **Eval harness with real metrics** — 12-question fixture derived from an included test doc, scored with **hit@K + MRR + mean top-1 similarity**. Every retrieval change gets a before/after table (see `eval-results.md`).
- **Cited answers** — the model outputs Markdown blockquotes matching a strict format the UI parses into styled citation cards. Answers that can't be sourced explicitly refuse ("I don't have that in your documents") rather than hallucinate.
- **Multi-tenant safe by construction** — every query, insert, and delete scopes by `userId`. Verified in the security review below.
- **Deploy-ready even without deploying** — env-driven Upstash swap for rate limiting, cascade-safe deletes, structured migrations, sanitized error responses, credential rotation guide.

## Current retrieval quality

Measured against the 12-question Aurora fixture, K=5:

| Strategy | hit@5 | MRR | mean top-1 sim |
|---|---|---|---|
| Dense-only (baseline) | 0.917 | 0.861 | 0.537 |
| **Hybrid RRF (production)** | **1.000** | **0.944** | 0.531 |

Hybrid closes the one dense-only miss (question mentioned words that never appear in the target chunk) and promotes another borderline hit from rank #3 → #1. Full per-question breakdown in [`eval-results.md`](./eval-results.md); re-run any time with `npm run eval`.

---

## Features

**Ingestion**
- Drag-and-drop upload for PDF, `.txt`, `.md`, `.markdown` (up to 10 MB)
- Recursive chunker (1000 chars, 200 overlap) — hand-written to avoid `@langchain/textsplitters` churn
- Batched OpenAI embeddings (100 chunks per call)
- One-round-trip multi-row `INSERT` with `::vector` cast for pgvector
- Fully transactional — no orphan Documents on failure

**Chat**
- Streaming answers via Vercel AI SDK's `streamText` + `useChat`
- Inline citation rendering (custom line-by-line parser — no markdown library)
- **Persistent history** — messages saved to `Conversation` + `Message` tables, hydrated on page load
- "New chat" resets to a fresh conversation; old ones remain in the DB (deletable via API)
- Auto-titled from first user message

**Security**
- Clerk-gated `/dashboard/*` and `/api/*` routes
- Per-user rate limits: 5 uploads/min · 50 uploads/day · 10 chats/min · 200 chats/day · 60 reads/min
- Per-user quotas: 100 documents max · 500 chunks max per file
- Chunk cap enforced **before** the embedding call — prevents a spammy upload from burning OpenAI credits before rejection
- Sanitized error responses — raw stack traces stay server-side
- Validated `id` shape on DELETEs (rejects scanner junk without hitting the DB)
- In-memory rate limiter for dev; swaps to Upstash Redis if `UPSTASH_REDIS_REST_*` env vars are set (see `src/lib/security/rateLimit.ts`)

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
                                  │  ├─ streamText(gpt-4o-mini)          │
                                  │  └─ onFinish → persist turn to DB    │
                                  └──────────────────────────────────────┘
```

The retriever interface is a `(userId, query, k) → chunks` function — the same signature is passed to both the chat route and the eval harness, so any new strategy can be A/B'd on the same fixture without touching call sites.

---

## Setup

Requirements: Node 22+, a Supabase project with pgvector enabled, an OpenAI API key, a Clerk app.

```powershell
git clone <this repo>
cd rag-knowledge-base
npm install
cp .env.example .env
# then fill in .env — see CREDENTIALS.md for what each value is + where it lives
npx prisma migrate deploy
npm run dev
```

Open `http://localhost:3000`, sign up, go to `/dashboard/documents`, upload something (there's a test doc under `test-fixtures/`), then `/dashboard/chat` to query it.

### Run the eval

```powershell
npm run eval
# writes eval-results.md with a before/after table for every registered strategy
```

---

## Repo layout

```
rag-knowledge-base/
├─ src/
│  ├─ app/
│  │  ├─ api/
│  │  │  ├─ chat/route.ts             — retrieval + streaming answer + persist
│  │  │  ├─ conversations/            — CRUD for chat history
│  │  │  └─ documents/                — upload / list / delete
│  │  ├─ dashboard/                   — protected pages (docs, chat)
│  │  ├─ (auth)/                      — sign-in / sign-up (Clerk)
│  │  ├─ page.tsx                     — landing
│  │  ├─ layout.tsx                   — nav shell (sticky, backdrop-blur)
│  │  └─ globals.css                  — Tailwind + design tokens
│  ├─ components/
│  │  ├─ chat/                        — ChatPanel, MessageBubble
│  │  └─ documents/                   — FileUpload, DocumentList
│  ├─ lib/
│  │  ├─ auth/getOrCreateUser.ts      — Clerk → Prisma User bootstrap
│  │  ├─ chat/persistence.ts          — Conversation / Message helpers
│  │  ├─ eval/                        — question fixture, metrics, runner
│  │  ├─ rag/
│  │  │  ├─ chunking.ts               — recursive splitter
│  │  │  ├─ embeddings.ts             — OpenAI batching
│  │  │  ├─ extract.ts                — pdf-parse + text passthrough
│  │  │  ├─ hybrid.ts                 — dense + sparse RRF (production)
│  │  │  ├─ ingest.ts                 — orchestrator + transaction
│  │  │  ├─ prompt.ts                 — system prompt + citation format
│  │  │  └─ retrieve.ts               — dense-only baseline
│  │  ├─ security/rateLimit.ts        — in-memory / Upstash limiter
│  │  ├─ openai.ts                    — singleton
│  │  └─ prisma.ts                    — singleton with PrismaPg adapter
│  ├─ generated/prisma/               — generated client (Prisma 7 pattern)
│  └─ proxy.ts                        — Clerk middleware (Next 16 rename of middleware.ts)
├─ prisma/
│  ├─ schema.prisma                   — User, Document, Chunk, Conversation, Message
│  └─ migrations/                     — versioned SQL
├─ scripts/
│  ├─ eval.ts                         — CLI: baseline vs. hybrid, writes eval-results.md
│  └─ debug-retrieve.ts               — one-off top-K dump for a single query
├─ test-fixtures/                     — sample docs for ingestion + eval
├─ eval-results.md                    — checked-in eval artifact
├─ CREDENTIALS.md                     — where every secret lives + how to rotate
├─ handoff.md                         — session-restart context for AI-assisted dev
└─ AGENTS.md                          — reminder that this Next isn't your training-data Next
```

---

## Security posture

Two axes: unauthorized data access (multi-tenant isolation) and spam / cost DoS. Full findings + status in [`handoff.md`](./handoff.md) §"Security posture". Highlights:

- **Fixed:** rate limits (five buckets), per-user document + chunk caps, sanitized error responses, typed 401 responses, filename length cap, DELETE id shape validation, cross-tenant scoping on every DB query.
- **Deferred:** pagination on `GET /api/documents` (rate-limited instead — no exploit path, cosmetic under 50 docs), PDF worker memory bound (needs external process, platform-layer not code).
- **Not a bug (verified):** parameterized raw SQL, Clerk SameSite session cookies handling CSRF, React escaping on all user-rendered strings.

For credential rotation (leaked keys, deploy prep): [`CREDENTIALS.md`](./CREDENTIALS.md).

---

## Roadmap / honest limitations

- **Not yet deployed publicly.** Code is deploy-ready (Upstash swap wired, migrations versioned, cascade deletes, env template complete) but no live URL exists. Vercel is the obvious target when I do.
- **No cross-encoder rerank stage.** The eval's one remaining #3 result (encryption question — chunking artifact) would likely go to #1 with a Cohere or Voyage reranker. Deferred to keep the dep count small.
- **In-memory rate limits by default.** Fine for solo dev / single container; multi-region deploys should flip on Upstash via env vars.
- **No conversation sidebar yet.** Chat persists per-user, but the UI only exposes the most recent conversation + a "New chat" button. Full history browsing is a natural next step.

---

## Learn-log

Kept as durable notes in [`handoff.md`](./handoff.md), including breaking changes I hit and workarounds:

- **Next 16** renamed `middleware.ts` → `proxy.ts`; `<SignedIn>` in Clerk 7 → `<Show when="signed-in">`; `auth.protect()` is async.
- **Prisma 7** moved `url`/`directUrl` out of `schema.prisma` into `prisma.config.ts`; needs `@prisma/adapter-pg`; imports `PrismaClient` from a generated path, not `@prisma/client`.
- **Vercel AI SDK 7** `convertToModelMessages` became async; `useChat` v6→v7 dropped `input`/`handleInputChange`/`handleSubmit` — caller manages input state, calls `sendMessage({text})`; `.toDataStreamResponse()` → `.toUIMessageStreamResponse()`.
- **Postgres full-text** `websearch_to_tsquery` AND-joins terms → too many misses on natural-language queries. Fix in `src/lib/rag/hybrid.ts::buildTsQuery`: sanitize + OR-join. That one change took hit@5 from 0.917 → 1.000.
- **Supabase free tier** auto-pauses idle projects; the pooler responds with a cryptic "tenant not found" error. Restore + restart the dev server clears it.

---

Built as a portfolio project to demonstrate depth in retrieval-augmented systems, security-conscious API design, and measurable iteration. Feedback welcome.
