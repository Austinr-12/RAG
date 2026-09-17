import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { extractText } from "@/lib/rag/extract";
import { chunkText } from "@/lib/rag/chunking";
import { embedBatch, EMBEDDING_DIMENSIONS } from "@/lib/rag/embeddings";
import { UPLOAD_LIMITS } from "@/lib/security/rateLimit";

export type IngestInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  userId: string;
  /**
   * When set, the document-count quota is re-checked inside the insert
   * transaction. The route's pre-check rejects cheaply before embedding
   * spend; this one closes most of the count-then-insert race window
   * (soft cap — parallel transactions can still slip past under READ
   * COMMITTED, but the upload rate limit bounds that to a handful).
   */
  maxDocuments?: number;
};

export type IngestResult = { documentId: string; chunkCount: number };

// Why: distinct error class so the upload route can map this to HTTP 413 without
// swallowing other errors or leaking raw messages from unexpected failures.
export class ChunkLimitExceededError extends Error {
  constructor(chunkCount: number, limit: number) {
    super(
      `File would produce ${chunkCount} chunks (limit ${limit}). Split the file into smaller pieces.`,
    );
    this.name = "ChunkLimitExceededError";
  }
}

// Why: same pattern for the document quota so the route maps it to HTTP 409.
export class DocumentQuotaExceededError extends Error {
  constructor(limit: number) {
    super(
      `Document quota reached (${limit}). Delete some before uploading more.`,
    );
    this.name = "DocumentQuotaExceededError";
  }
}

export async function ingest(input: IngestInput): Promise<IngestResult> {
  const text = await extractText(input.buffer, input.mimeType);
  if (!text.trim()) throw new Error("No extractable text in file");

  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error("Chunking produced no chunks");
  // Why: cap enforced BEFORE embedBatch so a spammy upload can't burn OpenAI
  // credits before being rejected.
  if (chunks.length > UPLOAD_LIMITS.maxChunksPerFile) {
    throw new ChunkLimitExceededError(chunks.length, UPLOAD_LIMITS.maxChunksPerFile);
  }

  const filename = input.filename.slice(0, UPLOAD_LIMITS.maxFilenameChars);

  const embeddings = await embedBatch(chunks);
  if (embeddings.some((e) => e.length !== EMBEDDING_DIMENSIONS)) {
    throw new Error("Embedding dimension mismatch");
  }

  // Why: Prisma's typed client can't write Unsupported("vector(1536)") rows, so the
  // chunk insert goes through raw SQL. Wrapping the Document create + Chunk insert in
  // one transaction prevents an orphan Document if the chunk insert fails.
  const documentId = await prisma.$transaction(async (tx) => {
    if (input.maxDocuments !== undefined) {
      const count = await tx.document.count({
        where: { userId: input.userId },
      });
      if (count >= input.maxDocuments) {
        throw new DocumentQuotaExceededError(input.maxDocuments);
      }
    }
    const doc = await tx.document.create({
      data: { name: filename, userId: input.userId },
      select: { id: true },
    });
    await insertChunks(tx, doc.id, chunks, embeddings);
    return doc.id;
  });

  return { documentId, chunkCount: chunks.length };
}

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function insertChunks(
  tx: TxClient,
  documentId: string,
  contents: string[],
  embeddings: number[][],
): Promise<void> {
  // Why: one parameterized multi-row INSERT keeps ingestion to a single round-trip.
  // pgvector accepts a JSON-array text literal cast to ::vector.
  const values: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < contents.length; i++) {
    const base = i * 5;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}::vector, $${base + 4}, $${base + 5})`,
    );
    params.push(
      randomUUID(),
      contents[i],
      JSON.stringify(embeddings[i]),
      documentId,
      i,
    );
  }
  await tx.$executeRawUnsafe(
    `INSERT INTO "Chunk" (id, content, embedding, "documentId", index) VALUES ${values.join(", ")}`,
    ...params,
  );
}
