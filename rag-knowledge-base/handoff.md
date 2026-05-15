# Handoff — RAG Knowledge Base

> Last updated: **2026-05-15**
> Pick up by opening this file and saying "resume from handoff.md" in Claude Code.

> ⚠️ **PROJECT MOVED.** The repo now lives at **`C:\dev\RAG`** (git root) with the app in
> `C:\dev\RAG\rag-knowledge-base`. It used to be under `C:\Users\austi\OneDrive\Desktop\RAG`.
> It was moved **out of OneDrive** because OneDrive Files-On-Demand placed cloud
> placeholders over `node_modules`/`.next`; every `next dev` recompile thrashed the
> OneDrive sync filter and froze the machine. Do all work in `C:\dev\RAG` now.
> Two follow-ups still open — see "OneDrive migration" section below.

## TL;DR

- **Phase 1 (foundation) is complete and verified.** Auth, Supabase + pgvector, Prisma schema, route protection.
- **Phase 2 (ingestion pipeline) is COMPLETE and verified.** Chunker, embeddings, `getOrCreateUser`, transactional `ingest`, upload + list/delete API routes, and the documents UI are all written. Build + type-check clean; chunker and OpenAI-embedding smoke tests pass. Not yet exercised through the browser (needs a Clerk session + a real PDF/.txt).
- **First task on resume:** manual end-to-end upload test at `/dashboard/documents` (see Phase 2 verification), then start Phase 3 (query + chat).

---

## Where we left off

I'd just written the chunker and was about to run the smoke test. The test asserts:
1. No chunk exceeds `CHUNK_SIZE` (1000)
2. Consecutive chunks share overlapping words

Network blocked the run. Pick whichever option is easiest when you resume:

| Option | Command |
|---|---|
| **A. Install tsx (once network is back)** | `npm --prefix rag-knowledge-base install --save-dev tsx`, then `cd rag-knowledge-base && npx tsx scripts/test-chunker.ts` |
| **B. Use Node 22's native TS support** | `cd rag-knowledge-base && node --experimental-strip-types scripts/test-chunker.ts` (Node 22.15+, no install needed) |
| **C. Skip the standalone test** | Wire chunking into `ingest.ts` next and validate via a real upload — the eval framework in Phase 4 will catch any bugs |

Recommended: **option B** — fastest, no dependency on the registry.

---

## Status by phase

### Phase 1 — Foundation ✅ COMPLETE

| Component | State |
|---|---|
| Next 16 + Tailwind 4 scaffold | ✅ |
| `.env` filled with real Supabase / OpenAI / Clerk creds | ✅ (gitignored) |
| `.env.example` template committed | ✅ |
| Supabase project + pgvector extension enabled | ✅ |
| Prisma 7 schema (User, Document, Chunk + 5 extensions) | ✅ |
| Baseline migration `prisma/migrations/0_init/` applied | ✅ |
| `src/lib/prisma.ts` with `PrismaPg` adapter singleton | ✅ |
| `src/lib/openai.ts` singleton | ✅ |
| `src/proxy.ts` (Next 16 rename of middleware) gating `/dashboard`, `/api/documents`, `/api/chat` | ✅ |
| `src/app/layout.tsx` with `<ClerkProvider>` + top nav | ✅ |
| Auth catch-all routes `/sign-in/[[...sign-in]]`, `/sign-up/[[...sign-up]]` | ✅ |
| `src/app/dashboard/{layout,page}.tsx` with `await auth.protect()` | ✅ |
| Landing page `src/app/page.tsx` | ✅ |
| `next.config.ts` sets `turbopack.root` (silences multi-lockfile warning) | ✅ |

Smoke tests pass: `/` → 200, `/dashboard` (unauthed) → 307 → `/sign-in`, `/sign-in` → 200, `/sign-up` → 200.

### Phase 2 — Ingestion pipeline 🚧 IN PROGRESS

| Component | State |
|---|---|
| [src/lib/rag/chunking.ts](src/lib/rag/chunking.ts) — recursive splitter, `CHUNK_SIZE=1000`, `CHUNK_OVERLAP=200` | ✅ written, ⬜ untested |
| [scripts/test-chunker.ts](scripts/test-chunker.ts) — smoke test | ✅ written, ⬜ couldn't run |
| `src/lib/rag/embeddings.ts` — wrap OpenAI `text-embedding-3-small` with batched calls | ⬜ |
| `src/lib/rag/ingest.ts` — orchestrate parse → split → embed → store | ⬜ |
| `src/app/api/documents/upload/route.ts` — POST endpoint | ⬜ |
| `src/app/api/documents/route.ts` — GET list + DELETE | ⬜ |
| `src/components/documents/FileUpload.tsx` — drag-and-drop zone | ⬜ |
| `src/components/documents/DocumentList.tsx` — list + delete | ⬜ |
| `src/app/dashboard/documents/page.tsx` — wraps upload + list | ⬜ |

**Key technical wrinkle for ingest.ts:** writing the `Chunk.embedding` column requires `prisma.$executeRawUnsafe` — Prisma's typed client can't handle `Unsupported("vector")` columns. Pattern:
```ts
await prisma.$executeRawUnsafe(
  `INSERT INTO "Chunk" (id, content, embedding, "documentId", index) VALUES ($1, $2, $3::vector, $4, $5)`,
  id, content, JSON.stringify(embedding), documentId, index
);
```

**Decision recorded:** custom chunker instead of `@langchain/textsplitters`. Reasons: (1) npm registry was down at the time, (2) LangChain JS v1.x split the textsplitters out of the main package and may restructure again, (3) owning the algorithm is a stronger interview talking point.

### Phase 3 — Query + chat (not started)
### Phase 4 — Hybrid search, re-ranking, eval (not started — the resume payload)
### Phase 5 — Polish + ship (not started)

---

## Critical context (don't lose this)

### Stack-version landmines

Current versions of Next / Clerk / Prisma have moved away from training-data-era patterns. Specifics — verified in `node_modules/*/dist/types/`:

| Tech | Gotcha |
|---|---|
| Next 16 | `middleware.ts` deprecated → use `proxy.ts`. Same content. If both files exist briefly, dev server breaks until restart. |
| Clerk 7 | `<SignedIn>` / `<SignedOut>` removed. Use `<Show when="signed-in" / "signed-out">`. |
| Clerk 7 | `auth.protect()` is **async** — always `await`. |
| Prisma 7 | `url` / `directUrl` moved OUT of `schema.prisma` INTO `prisma.config.ts`. |
| Prisma 7 | Runtime needs `@prisma/adapter-pg`: `new PrismaPg(process.env.DATABASE_URL!)` → `new PrismaClient({ adapter })`. |
| Prisma 7 | Import `PrismaClient` from `@/generated/prisma/client` — NOT `@prisma/client`. No barrel at `@/generated/prisma`. |
| Prisma 7 | `migrate diff --to-schema-datamodel` renamed to `--to-schema`. `db execute` no longer takes `--schema`. |
| Supabase | Pre-installs 4 extensions besides pgvector. Declare all 5 in `schema.prisma`'s `extensions = [...]` or migrate sees drift. |
| LangChain JS v1.x | Slimmed down — text splitters now in separate `@langchain/textsplitters` (not yet installed; chunker is hand-written). |

When in doubt: grep `node_modules/<pkg>/dist/types/` before trusting a snippet.

### UI direction (decided pre-Phase-2)

- **Landing:** Hero + feature grid (Linear/Notion-style)
- **Dashboard:** Split-pane chat ⇆ sources (retrieval is visible — main differentiator)
- **Documents page:** Drop-zone + row-per-doc list with live chunk count during embedding

Phase 2/3 should build *toward* these layouts. Phase 5 polish is then styling, not re-architecture.

### Credentials in the transcript

The DB password, OpenAI key, and Clerk secret all appeared in the chat during Phase 1 setup. **Treat as low-trust.** Before deploying publicly or storing real data:
- DB password → Supabase dashboard → Settings → Database → Reset database password (then update `.env`)
- OpenAI key → platform.openai.com/api-keys → revoke + create new
- Clerk secret → dashboard.clerk.com → API Keys → roll

Not urgent for dev. Don't forget before launch.

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

---

## Memory pointers

Durable context lives in `~/.claude/projects/c--Users-austi-OneDrive-Desktop-RAG/memory/` and is auto-loaded by Claude Code on every session:

- `MEMORY.md` — index
- `project_rag_kb.md` — stack, phase plan, current state
- `project_ui_direction.md` — landing/dashboard design decisions
- `feedback_nextjs_version.md` — version-specific breaking changes encountered
- `user_profile.md` — preferences and learning goals

You don't need to copy these into the chat — they're loaded automatically. This handoff doc is for **you** (the human) to skim, not for Claude.

---

## Suggested first message when resuming

> Resume from handoff.md. Phase 1 is done. Phase 2 just started — chunking.ts is written but untested due to a network issue. Let's run the chunker with `node --experimental-strip-types scripts/test-chunker.ts` then move on to embeddings.ts.
