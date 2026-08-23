import { NextResponse } from "next/server";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  getOrCreateUser,
  UnauthenticatedError,
} from "@/lib/auth/getOrCreateUser";
import {
  BUCKETS,
  CHAT_LIMITS,
  checkRateLimit,
} from "@/lib/security/rateLimit";
// Why: hybrid retrieval (dense + sparse RRF) measurably beats dense-only on
// the Aurora eval — hit@5 0.917 → 1.000, MRR 0.861 → 0.944. See
// scripts/eval.ts and eval-results.md. `retrieve` is kept in the codebase as
// the baseline strategy for eval comparison but production chat uses hybrid.
import { hybridRetrieve as retrieve } from "@/lib/rag/hybrid";
import {
  CHAT_MODEL,
  SYSTEM_PROMPT,
  buildRetrievalPrompt,
} from "@/lib/rag/prompt";

// Why: OpenAI streaming works fine on the Node runtime and matches the rest of
// the app. Edge would trim a bit of latency but complicates pdf-parse in ingest,
// which we already ruled out. Stay consistent across routes.
export const runtime = "nodejs";
// Why: model generation can take up to ~30s for a long answer + retrieval overhead.
export const maxDuration = 60;

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
    BUCKETS.chatMinute,
    user.id,
    CHAT_LIMITS.perMinute,
    60_000,
  );
  if (!minuteCheck.ok) return tooMany("Too many messages. Slow down.", minuteCheck.retryAfterSec);

  const dayCheck = checkRateLimit(
    BUCKETS.chatDay,
    user.id,
    CHAT_LIMITS.perDay,
    24 * 60 * 60_000,
  );
  if (!dayCheck.ok) return tooMany("Daily message limit reached.", dayCheck.retryAfterSec);

  let body: { messages?: UIMessage[] };
  try {
    body = (await request.json()) as { messages?: UIMessage[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messages = body.messages ?? [];
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  // Why: the retrieval query is the latest user message. Assistant/system messages
  // don't drive new searches; the model uses the full turn history for context.
  const latest = [...messages].reverse().find((m) => m.role === "user");
  const question = latest ? uiMessageToText(latest) : "";

  if (!question.trim()) {
    return NextResponse.json({ error: "No user question in messages" }, { status: 400 });
  }
  if (question.length > CHAT_LIMITS.maxMessageChars) {
    return NextResponse.json(
      { error: `Message too long (max ${CHAT_LIMITS.maxMessageChars} chars)` },
      { status: 413 },
    );
  }

  try {
    const chunks = await retrieve(user.id, question);

    // Why: replace the latest user turn's raw text with the retrieval-augmented
    // prompt so the model sees the sources. The rest of the history stays intact
    // so multi-turn context still works.
    const augmentedMessages: UIMessage[] = messages.map((m) =>
      m.id === latest!.id
        ? {
            ...m,
            parts: [
              { type: "text", text: buildRetrievalPrompt(question, chunks) },
            ],
          }
        : m,
    );

    // Why: convertToModelMessages became async in ai v7 (may resolve remote
    // file parts before sending). Await it before passing to streamText.
    const modelMessages = await convertToModelMessages(augmentedMessages);

    const result = streamText({
      model: openai(CHAT_MODEL),
      system: SYSTEM_PROMPT,
      messages: modelMessages,
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.error("[chat] failed", err);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}

function uiMessageToText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function tooMany(message: string, retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: message, retryAfterSec },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
