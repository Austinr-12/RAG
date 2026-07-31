import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ingest, ChunkLimitExceededError } from "@/lib/rag/ingest";
import {
  getOrCreateUser,
  UnauthenticatedError,
} from "@/lib/auth/getOrCreateUser";
import {
  BUCKETS,
  UPLOAD_LIMITS,
  checkRateLimit,
} from "@/lib/security/rateLimit";

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
  let user: { id: string; clerkId: string };
  try {
    user = await getOrCreateUser();
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    throw err;
  }

  const minuteCheck = checkRateLimit(
    BUCKETS.uploadMinute,
    user.id,
    UPLOAD_LIMITS.perMinute,
    60_000,
  );
  if (!minuteCheck.ok) {
    return tooMany("Too many uploads. Slow down.", minuteCheck.retryAfterSec);
  }
  const dayCheck = checkRateLimit(
    BUCKETS.uploadDay,
    user.id,
    UPLOAD_LIMITS.perDay,
    24 * 60 * 60_000,
  );
  if (!dayCheck.ok) {
    return tooMany("Daily upload limit reached.", dayCheck.retryAfterSec);
  }

  const docCount = await prisma.document.count({ where: { userId: user.id } });
  if (docCount >= UPLOAD_LIMITS.maxDocumentsPerUser) {
    return NextResponse.json(
      {
        error: `Document quota reached (${UPLOAD_LIMITS.maxDocumentsPerUser}). Delete some before uploading more.`,
      },
      { status: 409 },
    );
  }

  try {
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
    if (err instanceof ChunkLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    // Why: raw err.message can leak SQL text, filesystem paths, or OpenAI billing
    // errors. Log details server-side, return a generic message to the client.
    console.error("[upload] failed", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

function tooMany(message: string, retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: message, retryAfterSec },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

function inferMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}
