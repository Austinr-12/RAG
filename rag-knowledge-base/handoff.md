# Handoff — RAG Knowledge Base

> Last updated: **2026-08-21**
> Pick up by opening this file and saying "resume from handoff.md" in Claude Code.

> ⚠️ **PROJECT LOCATION.** Repo lives at **`C:\dev\RAG`** (git root) with the app in
> `C:\dev\RAG\rag-knowledge-base`. It used to be under `C:\Users\austi\OneDrive\Desktop\RAG`
> but was moved out of OneDrive because Files-On-Demand thrashed `node_modules`/`.next`
> on every `next dev` recompile.

## TL;DR

- **Phase 1 (foundation) — complete and verified.**
- **Phase 2 (ingestion pipeline) — complete, verified, hardened, polished.**
- **Phase 3 (retrieval + chat) — COMPLETE and verified end-to-end.** `/api/chat` streams cited answers from `gpt-4o-mini` grounded in pgvector KNN retrieval. Golden path works (correct answer + citation for Aurora price + warranty questions), fallback works (refuses questions not in docs), abuse paths work (11th message/min → 429, 3000-char message → 413).
- **Recurring gotcha:** Supabase free tier auto-pauses the project. When you get `FATAL: (ENOTFOUND) tenant/user postgres.rcmwbfirmelhbnokqiuu not found`, go to supabase.com/dashboard → Restore project → wait ~90s → restart `next dev`.
- **AI SDK version pivot (recorded, don't re-discover):** `ai` v7 requires awaiting `convertToModelMessages()` (was sync in v6). `@ai-sdk/openai` + `@ai-sdk/react` install their own `ai@7` peer — top-level `ai` must be v7 to unify types.
- **First task on resume:** start Phase 4 — hybrid search + re-ranking + eval framework. This is the "resume payload" phase (per the original plan): quantifiable retrieval quality metrics for the portfolio.

---

## Where we left off

Phase 2 is fully done. This session:

1. Ran a full security review of Phase 2 (see "Security posture" below).
2. Applied hardening: rate limits, quotas, chunk cap, sanitized errors, typed 401 handling, filename cap, DELETE id validation.
3. Debugged Supabase pauses (twice) and an invalid OpenAI key — both external, no code bugs.
4. Verified E2E: uploaded `test-fixtures/aurora-notebook-handbook.md`, doc appeared in the list with correct chunk count.
5. Fixed drag-and-drop (was missing `dragenter` + spurious `dragleave` on child crossings).
6. Fixed navigation — `/dashboard` now has a real feature grid linking to `/dashboard/documents`, header has both nav links.
7. Design polish across landing, header, dashboard, drop zone, and document list. Also fixed a real bug in `globals.css` where `font-family: Arial` was overriding the Geist font.

Next chunk of work is **Phase 3**. See "Suggested first message when resuming" at the bottom.

---

## Status by phase

### Phase 1 — Foundation ✅ COMPLETE

Unchanged from prior handoff — auth, pgvector, Prisma singleton, route protection all verified.

### Phase 2 — Ingestion pipeline ✅ COMPLETE + HARDENED

| Component | State |
|---|---|
| [src/lib/rag/chunking.ts](src/lib/rag/chunking.ts) — recursive splitter, `CHUNK_SIZE=1000`, `CHUNK_OVERLAP=200` | ✅ verified in browser |
| [src/lib/rag/embeddings.ts](src/lib/rag/embeddings.ts) — OpenAI `text-embedding-3-small`, batched 100 | ✅ verified in browser |
| [src/lib/rag/extract.ts](src/lib/rag/extract.ts) — pdf-parse for PDF, utf8 for text/markdown | ✅ verified in browser |
| [src/lib/rag/ingest.ts](src/lib/rag/ingest.ts) — transactional extract→chunk→embed→insert | ✅ verified in browser |
| [src/lib/auth/getOrCreateUser.ts](src/lib/auth/getOrCreateUser.ts) — Clerk → Prisma User bootstrap, now with typed `UnauthenticatedError` | ✅ |
| [src/lib/security/rateLimit.ts](src/lib/security/rateLimit.ts) — **NEW** in-memory sliding-window limiter | ✅ |
| [src/app/api/documents/upload/route.ts](src/app/api/documents/upload/route.ts) — POST with size/mime/rate/quota checks | ✅ verified |
| [src/app/api/documents/route.ts](src/app/api/documents/route.ts) — GET list + DELETE by id, both rate-limited | ✅ verified |
| [src/components/documents/FileUpload.tsx](src/components/documents/FileUpload.tsx) — drag+drop + click, now with correct HTML5 event handling | ✅ verified |
| [src/components/documents/DocumentList.tsx](src/components/documents/DocumentList.tsx) — list + optimistic delete + relative dates | ✅ verified |
| [src/app/dashboard/documents/page.tsx](src/app/dashboard/documents/page.tsx) | ✅ |

**Key technical wrinkle for ingest.ts** (unchanged, still relevant): writing `Chunk.embedding` requires `$executeRawUnsafe` — Prisma's typed client can't handle `Unsupported("vector")` columns. The pattern uses parameterized multi-row insert (safe from SQL injection; the template is built from loop indices, not user data).

**Decision recorded:** custom chunker instead of `@langchain/textsplitters`.

### Phase 3 — Query + chat ✅ COMPLETE

| Component | State |
|---|---|
| [src/lib/rag/retrieve.ts](src/lib/rag/retrieve.ts) — top-K pgvector KNN, userId-scoped | ✅ |
| [src/lib/rag/prompt.ts](src/lib/rag/prompt.ts) — SYSTEM_PROMPT + `buildRetrievalPrompt`; instructs blockquote citations | ✅ |
| [src/app/api/chat/route.ts](src/app/api/chat/route.ts) — auth → rate limit (10/min, 200/day) → validate → retrieve top-5 → `streamText` → `toUIMessageStreamResponse()` | ✅ |
| [src/components/chat/ChatPanel.tsx](src/components/chat/ChatPanel.tsx) — v7 `useChat` (self-managed input), Enter-to-send, Stop button, typing dots, auto-scroll | ✅ |
| [src/components/chat/MessageBubble.tsx](src/components/chat/MessageBubble.tsx) — parses `> ` blockquotes into styled citation cards; supports `**bold**` + `- ` bullets. No markdown lib needed. | ✅ |
| [src/app/dashboard/chat/page.tsx](src/app/dashboard/chat/page.tsx) — page shell | ✅ |
| Dashboard card + nav wired to `/dashboard/chat` | ✅ |

**Design chosen (locked in during this phase):**
- Streaming: Vercel AI SDK (`ai@7` + `@ai-sdk/openai@4` + `@ai-sdk/react@4`)
- Chat history: session-only (React state; refresh clears)
- Citations: inline highlight-and-quote in the message body — no split-pane sources panel
- Model: `gpt-4o-mini` (see `CHAT_MODEL` in `prompt.ts`)

**Retrieval SQL pattern used** (works with pgvector — `<=>` = cosine distance, order ASC for most similar):
```sql
SELECT c.id AS "chunkId", c.content, c.index, c."documentId",
       d.name AS "documentName",
       1 - (c.embedding <=> $2::vector) AS similarity
FROM "Chunk" c
JOIN "Document" d ON d.id = c."documentId"
WHERE d."userId" = $1
ORDER BY c.embedding <=> $2::vector
LIMIT $3;
```
`$1` = userId from `getOrCreateUser` (cross-tenant guard), `$2` = `JSON.stringify(queryEmbedding)`, `$3` = k.

### Phase 4 — Hybrid search, re-ranking, eval (NOT STARTED — resume here)

This is the "resume payload" phase — the portfolio-defining work. Concrete tasks:
- `src/lib/rag/hybrid.ts` — combine dense vector retrieval with BM25/tsvector keyword search using reciprocal rank fusion. Postgres has native full-text via `to_tsvector` — no new dep needed.
- `src/lib/rag/rerank.ts` — optional cross-encoder rerank step (Cohere Rerank API or OpenAI-based). Improves precision when K is small.
- `src/lib/eval/` — evaluation harness: a small set of question+expected-source pairs, runs retrieval, scores hit@K and MRR. Report a before/after table.
- `src/app/dashboard/eval/page.tsx` — optional in-app eval dashboard showing metrics. Or keep it a CLI script and screenshot for the portfolio.

### Phase 5 — Polish + ship (not started; visual polish already well ahead of schedule)
- Persistence for chat history (Conversation + Message Prisma models) — currently session-only
- Pagination on `GET /api/documents` (deferred from security review)
- Swap in-memory rate limiter → Upstash for multi-instance deploys
- Credential rotation before public deploy (still open from Phase 1)
- Deploy to Vercel

---

## Security posture (applied this session)

Full review found 9 issues; 7 are fixed, 2 are deferred with rationale.

### Fixed
| # | Finding | Fix |
|---|---|---|
| H-1 | No rate limiting | 5 uploads/min + 50 uploads/day per user; 60 reads/min per user. `Retry-After` header on 429. Implemented in [rateLimit.ts](src/lib/security/rateLimit.ts). |
| H-2 | No per-user document quota | `UPLOAD_LIMITS.maxDocumentsPerUser = 100`, checked before ingest. |
| H-3 | No cap on chunks-per-file | `UPLOAD_LIMITS.maxChunksPerFile = 500`, enforced in ingest.ts **before** `embedBatch` so spam can't burn OpenAI credits. Throws typed `ChunkLimitExceededError` → HTTP 413. |
| M-5 | Raw `err.message` leaked to client | Generic messages returned; `console.error` server-side. Verified working — the OpenAI 401 response with a partial API key stayed in the log; client just saw "Upload failed". |
| M-6 | Unauth returned 500 not 401 | `UnauthenticatedError` class in `getOrCreateUser.ts`; all three routes catch and return 401. |
| L-7 | Filename length not capped | `MAX_FILENAME_LENGTH = 255` in ingest.ts. |
| L-9 | DELETE `id` not validated | Regex `[a-z0-9]{10,64}` gate before DB query. |

### Deferred (documented, not fixed)
| # | Finding | Why deferred |
|---|---|---|
| H-4 | `GET /api/documents` no pagination | Rate-limited to 60/min; not exploitable, harmless until a user has >50 docs. |
| L-8 | PDF worker no memory bound | pdf-parse has no cap; `maxDuration = 60` bounds time only. Fix requires external process or different parser — platform-level, not code-level. Revisit in Phase 5. |

### Known small residuals (not blockers)
- **Quota race**: user with 99 docs fires 2 uploads simultaneously → both pass the `< 100` check → user ends up with 101. Fix would move the count into the ingest transaction.
- **Body size checked post-buffer**: `request.formData()` reads the whole body into memory before our 10 MB check. Platform (Vercel: 4.5 MB hobby / 100 MB pro) is a hard ceiling in prod.
- **Storage math**: 100 docs × 10 MB × ~5× expansion (raw + chunks + vectors) ≈ 5 GB per user max. Supabase free tier caps at 500 MB. If you plan to keep this on free tier post-launch, drop `maxDocumentsPerUser` from 100 to 20.

### Verified NOT bugs
- Raw SQL insert in `ingest.ts` is parameterized (template built from loop indices)
- Cross-tenant read/write/delete: every query scopes by `userId`
- CSRF: handled by Clerk's SameSite=Lax session cookie
- XSS: no user content rendered as HTML anywhere (React escapes; `d.name` is truncated but escaped)

---

## Design system (established this session)

Aesthetic: **monochrome zinc, modern-minimalist**. Depth from typography scale + subtle shadows, not color. One deliberate accent: an emerald status dot in the landing pill badge.

Baseline choices:
- Font: Geist Sans (loaded via `next/font/google` in layout.tsx). `globals.css` no longer overrides it — the previous `font-family: Arial` line was a bug that silently downgraded typography everywhere.
- Header: sticky, `backdrop-blur-md`, subtle bottom border, brand mark as inline SVG monogram (two overlapping squares).
- Buttons: pill (`rounded-full`), monochrome, subtle shadow-on-hover.
- Cards: `rounded-2xl`, zinc border, refined `hover:shadow` with a two-layer offset for depth.
- Icons: inline SVG stroke (Lucide-style), no icon library dependency. They inherit `currentColor`.
- Focus ring: consistent `:focus-visible` outline defined once in `globals.css`.
- Row hover in the document list reveals the Delete button (Linear-style restraint).

If you're adding Phase 3 UI, match this vocabulary — don't introduce new colors or new corner radii.

---

## Test fixture

[test-fixtures/aurora-notebook-handbook.md](test-fixtures/aurora-notebook-handbook.md) — 7 KB fictional product handbook, chunks to ~8 pieces. Includes distinct searchable tokens (`AN15-B2`, `AuroraCare+`, `1-800-287-6721`, `2.4.0 firmware`, `AuroraCare Centers`) — useful now for ingestion verification, useful later for Phase 3 retrieval accuracy tests.

---

## Critical context (don't lose this)

### Recurring: Supabase auto-pause

**Symptom:** `FATAL: (ENOTFOUND) tenant/user postgres.rcmwbfirmelhbnokqiuu not found` when any route hits Prisma. Also appears in `npx prisma migrate status`.

**Cause:** Supabase free tier pauses idle projects. Happens more often than the docs claim — sometimes within days.

**Fix:**
1. supabase.com/dashboard → click "Restore project" (~90 s)
2. `cd rag-knowledge-base && npx prisma migrate status` — should say "up to date"
3. Restart `next dev` — Prisma cached dead connections from before the pause; restart clears them

**Long-term options:**
- Accept it (fine for portfolio)
- Upgrade to Supabase Pro ($25/mo)
- Add a GitHub Action or cron that hits a `SELECT 1` daily to prevent pause

### Stack-version landmines

Current versions of Next / Clerk / Prisma have moved away from training-data-era patterns.

| Tech | Gotcha |
|---|---|
| Next 16 | `middleware.ts` deprecated → use `proxy.ts`. Same content. If both files exist briefly, dev server breaks until restart. |
| Clerk 7 | `<SignedIn>` / `<SignedOut>` removed. Use `<Show when="signed-in" / "signed-out">`. |
| Clerk 7 | `auth.protect()` is **async** — always `await`. |
| Prisma 7 | `url` / `directUrl` moved OUT of `schema.prisma` INTO `prisma.config.ts`. |
| Prisma 7 | Runtime needs `@prisma/adapter-pg`: `new PrismaPg(process.env.DATABASE_URL!)` → `new PrismaClient({ adapter })`. |
| Prisma 7 | Import `PrismaClient` from `@/generated/prisma/client` — NOT `@prisma/client`. |
| Prisma 7 | `migrate diff --to-schema-datamodel` renamed to `--to-schema`. `db execute` no longer takes `--schema`. |
| Supabase | Pre-installs 4 extensions besides pgvector. Declare all 5 in `schema.prisma`'s `extensions = [...]` or migrate sees drift. |
| LangChain JS v1.x | Slimmed down — text splitters now in `@langchain/textsplitters` (not installed; chunker is hand-written). |

When in doubt: grep `node_modules/<pkg>/dist/types/` before trusting a snippet. (See also `AGENTS.md`.)

### HTML5 drag-and-drop gotcha (fixed this session — don't reintroduce)

If you touch [FileUpload.tsx](src/components/documents/FileUpload.tsx):
- `onDragEnter` AND `onDragOver` both need `preventDefault()` or the browser refuses to fire `drop`.
- `onDragLeave` fires whenever the cursor crosses a child element — only reset the drag state when `!e.currentTarget.contains(e.relatedTarget as Node | null)`.
- Set `dataTransfer.dropEffect = "copy"` on dragOver for the correct cursor icon.

### Credentials in the transcript (STILL open)

DB password, OpenAI key, and Clerk secret all appeared in the chat during Phase 1 setup. **Treat as low-trust.** Before deploying publicly or storing real data:
- DB password → Supabase dashboard → Settings → Database → Reset (then update `.env`)
- OpenAI key → platform.openai.com/api-keys → revoke + create new
- Clerk secret → dashboard.clerk.com → API Keys → roll

Not urgent for dev. Hard prerequisite before ANY public URL.

---

## How to start the dev server

```powershell
cd rag-knowledge-base
npm run dev
```

If port 3000 is taken:
```powershell
netstat -ano | findstr :3000
taskkill /F /PID <pid>
```

If routes 500 with a Prisma error → check Supabase project state (see "Recurring: Supabase auto-pause" above).

---

## Memory pointers

Durable context lives in `~/.claude/projects/c--dev-RAG/memory/` (NOTE: prior handoff pointed at the OneDrive path, which is stale). Auto-loaded by Claude Code on every session:

- `MEMORY.md` — index (may need to be regenerated in the new path)
- `project_rag_kb.md` — stack, phase plan, current state
- `project_ui_direction.md` — landing/dashboard design decisions
- `feedback_nextjs_version.md` — version-specific breaking changes encountered
- `user_profile.md` — preferences and learning goals

This handoff doc is for **you** (the human) to skim, not for Claude.

---

## Suggested first message when resuming

> Resume from handoff.md. Phases 1, 2, and 3 are done and verified end-to-end. Start Phase 4 — hybrid search + re-ranking + eval. First step: sketch the eval harness (question → expected-source pairs → hit@K + MRR) so we have a baseline metric BEFORE adding hybrid search. Then implement `src/lib/rag/hybrid.ts` (dense + tsvector BM25 with reciprocal rank fusion) and compare against baseline.
