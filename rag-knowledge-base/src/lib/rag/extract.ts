import { PDFParse } from "pdf-parse";

// Why: this module deliberately has no `@/` imports and no import-time side
// effects (no DB, no OpenAI). That keeps text extraction testable in isolation
// with `node --experimental-strip-types` — the same no-network pattern the
// chunker smoke test uses. ingest.ts re-imports extractText from here.

export const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
] as const;

export async function extractText(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
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
