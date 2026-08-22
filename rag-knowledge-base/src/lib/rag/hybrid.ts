import { prisma } from "@/lib/prisma";
import { embed } from "@/lib/rag/embeddings";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

// Why: hybrid retrieval combines dense (semantic, embedding-based) and sparse
// (lexical, keyword-based) signals. Dense catches paraphrase and concept match;
// sparse catches rare terms, exact model codes ("AN13-A1"), phone numbers,
// SKUs — the tokens embeddings tend to blur.
//
// Fusion strategy: Reciprocal Rank Fusion (RRF). RRF is stateless and needs
// no tuning across corpora — score(chunk) = Σ 1 / (k + rank_i) across
// candidate lists. k=60 is the paper's default and works well in practice.
// Reference: Cormack, Clarke, Buettcher (2009).

const RRF_K = 60;
// Why: over-fetch from each retriever so the fusion has room to promote items
// that appear in both lists. If both lists overlap heavily, the extra rows are
// discarded cheaply; if they don't, we get better recall.
const CANDIDATE_MULTIPLIER = 3;
const DEFAULT_K = 5;

export type HybridOptions = {
  k?: number;
};

export async function hybridRetrieve(
  userId: string,
  query: string,
  opts: HybridOptions = {},
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const k = opts.k ?? DEFAULT_K;
  if (k <= 0) return [];

  const candidateN = k * CANDIDATE_MULTIPLIER;

  // Why: run dense + sparse in parallel; both are single round-trips.
  const queryEmbedding = await embed(trimmed);

  const [denseRows, sparseRows] = await Promise.all([
    denseCandidates(userId, queryEmbedding, candidateN),
    sparseCandidates(userId, trimmed, candidateN),
  ]);

  const fused = reciprocalRankFusion([denseRows, sparseRows]);

  // Why: RRF returns rows without a "similarity" field — that number is only
  // meaningful for the dense list. When a chunk was in the dense list, keep
  // its cosine similarity; otherwise fall back to 0 (report it as sparse-only).
  const denseSim = new Map(denseRows.map((r) => [r.chunkId, r.similarity]));
  return fused.slice(0, k).map((r) => ({
    ...r,
    similarity: denseSim.get(r.chunkId) ?? 0,
  }));
}

type Row = {
  chunkId: string;
  content: string;
  index: number;
  documentId: string;
  documentName: string;
  similarity: number;
};

async function denseCandidates(
  userId: string,
  queryEmbedding: number[],
  limit: number,
): Promise<Row[]> {
  return prisma.$queryRawUnsafe<Row[]>(
    `SELECT
       c.id            AS "chunkId",
       c.content       AS "content",
       c.index         AS "index",
       c."documentId"  AS "documentId",
       d.name          AS "documentName",
       1 - (c.embedding <=> $2::vector) AS "similarity"
     FROM "Chunk" c
     JOIN "Document" d ON d.id = c."documentId"
     WHERE d."userId" = $1
     ORDER BY c.embedding <=> $2::vector
     LIMIT $3`,
    userId,
    JSON.stringify(queryEmbedding),
    limit,
  );
}

async function sparseCandidates(
  userId: string,
  query: string,
  limit: number,
): Promise<Row[]> {
  // Why: `websearch_to_tsquery` handles user-typed queries (quoted phrases,
  // OR, negation) without throwing on punctuation the way `plainto_tsquery`
  // does not — but plainto is simpler and matches most user questions. We
  // use `websearch_to_tsquery` for its robustness to natural-language input.
  // `ts_rank_cd` with normalization=1 divides by 1 + log(doc length) so long
  // chunks don't dominate.
  return prisma.$queryRawUnsafe<Row[]>(
    `SELECT
       c.id            AS "chunkId",
       c.content       AS "content",
       c.index         AS "index",
       c."documentId"  AS "documentId",
       d.name          AS "documentName",
       0::float        AS "similarity"
     FROM "Chunk" c
     JOIN "Document" d ON d.id = c."documentId"
     WHERE d."userId" = $1
       AND to_tsvector('english', c.content) @@ websearch_to_tsquery('english', $2)
     ORDER BY ts_rank_cd(to_tsvector('english', c.content), websearch_to_tsquery('english', $2), 1) DESC
     LIMIT $3`,
    userId,
    query,
    limit,
  );
}

function reciprocalRankFusion(lists: Row[][]): Row[] {
  const scores = new Map<string, { row: Row; score: number }>();
  for (const list of lists) {
    list.forEach((row, i) => {
      const rank = i + 1;
      const contribution = 1 / (RRF_K + rank);
      const existing = scores.get(row.chunkId);
      if (existing) {
        existing.score += contribution;
      } else {
        scores.set(row.chunkId, { row, score: contribution });
      }
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map((x) => x.row);
}
