import { NextResponse } from "next/server";
import { ingest } from "@/lib/rag/ingest";
import { getOrCreateUser } from "@/lib/auth/getOrCreateUser";

// Why: pdf-parse pulls in pdfjs + canvas which are Node-only; being explicit
// prevents an accidental edge-runtime regression if a parent segment opts in.
export const runtime = "nodejs";
// Why: embedding 50-chunk docs can take ~20s of OpenAI time.
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
]);

export async function POST(request: Request) {
  try {
    const user = await getOrCreateUser();

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 10MB limit" }, { status: 413 });
    }
    // Why: browser-reported file.type is sometimes empty (.md on Windows); fall back to extension.
    const mime = file.type || inferMime(file.name);
    if (!ALLOWED_MIME.has(mime)) {
      return NextResponse.json(
        { error: "Only PDF, plain text, and markdown are supported" },
        { status: 415 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await ingest({
      buffer,
      filename: file.name,
      mimeType: mime,
      userId: user.id,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("[upload] failed", err);
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function inferMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}
