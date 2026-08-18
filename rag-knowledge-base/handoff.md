# Handoff — RAG Knowledge Base

> Last updated: **2026-08-18**
> Pick up by opening this file and saying "resume from handoff.md" in Claude Code.

> ⚠️ **PROJECT LOCATION.** Repo lives at **`C:\dev\RAG`** (git root) with the app in
> `C:\dev\RAG\rag-knowledge-base`. It used to be under `C:\Users\austi\OneDrive\Desktop\RAG`
> but was moved out of OneDrive because Files-On-Demand thrashed `node_modules`/`.next`
> on every `next dev` recompile.

## TL;DR

- **Phase 1 (foundation) — complete and verified.** Auth, Supabase + pgvector, Prisma schema, route protection.
- **Phase 2 (ingestion pipeline) — complete, verified end-to-end, hardened, and visually polished.** Upload → chunk → embed → store cycle works through the browser with a real Clerk session and a real file. Security review applied (7 of 9 findings fixed; 2 deferred with rationale below). UI reworked to a modern-minimalist zinc aesthetic.
- **Recurring gotcha:** Supabase free tier auto-pauses the project. When you get `FATAL: (ENOTFOUND) tenant/user postgres.rcmwbfirmelhbnokqiuu not found`, go to supabase.com/dashboard → Restore project → wait ~90s → restart `next dev`.
- **First task on resume:** start Phase 3 — query + chat. Ingestion is not the bottleneck anymore.

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

### Phase 3 — Query + chat (NOT STARTED — resume here)

Files to create:
- `src/lib/rag/retrieve.ts` — embed the query, run pgvector similarity search, return top-K chunks with source metadata
- `src/app/api/chat/route.ts` — POST endpoint that takes a question, retrieves, streams a generated answer via OpenAI, cites the chunks it used. **Apply the same rate limiting** from `src/lib/security/rateLimit.ts`.
- `src/components/chat/*` — split-pane UI (chat on the left, sources on the right per handoff §"UI direction")
- Wire into `/dashboard` — currently the "Chat" card is disabled with a "Coming in Phase 3" badge. Flip it to a real link once the route exists.

Retrieval SQL pattern (works with pgvector — the `<=>` operator gives cosine distance, order ASC for most similar):
```sql
SELECT id, content, "documentId"
FROM "Chunk"
WHERE "documentId" IN (
  SELECT id FROM "Document" WHERE "userId" = $1
)
ORDER BY embedding <=> $2::vector
LIMIT 8;
```
`$1` = userId from `getOrCreateUser`, `$2` = `JSON.stringify(queryEmbedding)`. Scoping by userId in the subquery is the cross-tenant guard.

### Phase 4 — Hybrid search, re-ranking, eval (not started — the resume payload)
### Phase 5 — Polish + ship (not started, though visual polish is well ahead of schedule)

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

> Resume from handoff.md. Phases 1 and 2 are done and verified. Start Phase 3 — retrieval + chat. First step: build `src/lib/rag/retrieve.ts` that embeds a query and runs a pgvector similarity search scoped by userId. Then wire an `/api/chat` route that streams a cited answer, applying the existing rate limiter from `src/lib/security/rateLimit.ts`.
