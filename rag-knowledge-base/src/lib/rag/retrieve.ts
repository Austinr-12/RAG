import { prisma } from "@/lib/prisma";
import { embed } from "@/lib/rag/embeddings";

// Why: retrieval defaults. K=5 is a common sweet spot for RAG — enough context
// to answer follow-up-style questions, few enough that the LLM prompt stays
// under budget and doesn't dilute focus. Tuneable via the opts argument.
export const RETRIEVE_DEFAULT_K = 5;

// Why: OpenAI embeddings are unit-normalized, so cosine distance from pgvector's
// `<=>` operator lives in [0, 2] and similarity = 1 - distance sits in [-1, 1].
// Real matches are typically > 0.3; noise floors around 0.1.
export type RetrievedChunk = {
  chunkId: string;
  content: string;
  index: number;
  documentId: string;
  documentName: string;
  similarity: number;
};

export type RetrieveOptions = {
  k?: number;
};

/**
 * Embed the query and return the top-K most similar chunks that belong to the
 * given user. Scoping by userId in the WHERE clause is the cross-tenant guard —
 * a user can never retrieve chunks from another user's documents.
 */
export async function retrieve(
  userId: string,
  query: string,
  opts: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const k = opts.k ?? RETRIEVE_DEFAULT_K;
  if (k <= 0) return [];

  const queryEmbedding = await embed(trimmed);

  // Why: raw SQL because Prisma's typed client can't express Unsupported("vector")
  // operations (see the mirror comment in ingest.ts). Parameterized with $1/$2/$3
  // via $queryRawUnsafe — safe from injection. Similarity = 1 - distance so
  // callers get an intuitive "higher is better" number.
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      chunkId: string;
      content: string;
      index: number;
      documentId: string;
      documentName: string;
      similarity: number;
    }>
  >(
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
    k,
  );

  return rows;
}
