import { randomUUID } from "node:crypto";
import { PDFParse } from "pdf-parse";
import { prisma } from "@/lib/prisma";
import { chunkText } from "@/lib/rag/chunking";
import { embedBatch, EMBEDDING_DIMENSIONS } from "@/lib/rag/embeddings";

export type IngestInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  userId: string;
};

export type IngestResult = { documentId: string; chunkCount: number };

export async function ingest(input: IngestInput): Promise<IngestResult> {
  const text = await extractText(input.buffer, input.mimeType);
  if (!text.trim()) throw new Error("No extractable text in file");

  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error("Chunking produced no chunks");

  const embeddings = await embedBatch(chunks);
  if (embeddings.some((e) => e.length !== EMBEDDING_DIMENSIONS)) {
    throw new Error("Embedding dimension mismatch");
  }

  // Why: Prisma's typed client can't write Unsupported("vector(1536)") rows, so the
  // chunk insert goes through raw SQL. Wrapping the Document create + Chunk insert in
  // one transaction prevents an orphan Document if the chunk insert fails.
  const documentId = await prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: { name: input.filename, userId: input.userId },
      select: { id: true },
    });
    await insertChunks(tx, doc.id, chunks, embeddings);
    return doc.id;
  });

  return { documentId, chunkCount: chunks.length };
}

async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const { text } = await parser.getText();
      return text;
    } finally {
      // Why: pdfjs spins up a worker; leaking it eventually OOMs the route.
      await parser.destroy();
    }
  }
  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    return buffer.toString("utf8");
  }
  throw new Error(`Unsupported mime type: ${mimeType}`);
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
