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

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

export function isSupportedMimeType(mime: string): mime is SupportedMimeType {
  return (SUPPORTED_MIME_TYPES as readonly string[]).includes(mime);
}

// Why: browser-reported file.type is sometimes empty (.md on Windows), and
// files read from disk have no mime at all — fall back to the extension. Lives
// here so the upload route and the corpus export script classify files
// identically.
export function inferMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

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
