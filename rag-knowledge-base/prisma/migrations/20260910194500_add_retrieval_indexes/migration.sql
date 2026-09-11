-- Retrieval indexes for the two arms of hybrid search (src/lib/rag/hybrid.ts).
-- Hand-written: Prisma's schema DSL can't express expression indexes or
-- indexes on Unsupported("vector") columns.

-- Sparse arm: the query filters and ranks with to_tsvector('english', content).
-- Without an index, every chat message recomputes that tsvector for every
-- chunk row (sequential scan, per-row CPU). This GIN expression index matches
-- the query expression exactly, so the @@ filter becomes an index lookup.
CREATE INDEX "Chunk_content_fts_idx" ON "Chunk"
  USING GIN (to_tsvector('english', "content"));

-- Dense arm: ORDER BY embedding <=> $query was a full scan + sort over every
-- candidate row. HNSW turns it into an approximate nearest-neighbor index
-- scan; vector_cosine_ops matches the <=> (cosine distance) operator used in
-- retrieve.ts / hybrid.ts. Approximate recall is gated by the Aurora eval
-- fixture (hit@5 / MRR must not regress) — see eval-results.md.
CREATE INDEX "Chunk_embedding_hnsw_idx" ON "Chunk"
  USING hnsw ("embedding" vector_cosine_ops);

-- Refresh planner statistics so the new indexes are considered immediately.
ANALYZE "Chunk";
