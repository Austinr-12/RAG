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
  // Why: `websearch_to_tsquery` AND-joins terms — that misses too many real
  // hits when the query has words that don't appear in the target chunk
  // (e.g. "What is AuroraCare+ and how much does it *cost*?" against a
  // chunk that mentions AuroraCare+ but uses "protection plan" instead of
  // "cost"). We build an OR-joined tsquery in JS so ANY meaningful term
  // matches, then let `ts_rank_cd` order by relevance. Documents with more
  // matching terms rank higher naturally.
  const tsquery = buildTsQuery(query);
  if (!tsquery) return [];

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
       AND to_tsvector('english', c.content) @@ to_tsquery('english', $2)
     ORDER BY ts_rank_cd(to_tsvector('english', c.content), to_tsquery('english', $2), 1) DESC
     LIMIT $3`,
    userId,
    tsquery,
    limit,
  );
}

// Why: build a safe OR-joined tsquery from user input. Strip everything except
// word chars, hyphens, and plus signs so nothing the user types can produce
// invalid tsquery syntax. Drop 1-char tokens (mostly stop-word residue and
// punctuation artifacts). No stop-word filtering here — Postgres handles that
// via the 'english' dictionary and treats stop-words as valid but zero-weight.
function buildTsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9+\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    // Escape trailing plus so tsquery doesn't parse it as a prefix operator.
    // Same for hyphens at the start (which mean NOT).
    .map((t) => t.replace(/^-+|[+]+$/g, ""))
    .filter((t) => t.length > 1);
  return tokens.join(" | ");
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
