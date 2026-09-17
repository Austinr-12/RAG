import { NextResponse } from "next/server";
import {
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { requireUser, unauthenticated, tooMany, ID_RE } from "@/lib/api/guards";
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
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_TEMPERATURE,
  SYSTEM_PROMPT,
  NO_SOURCES_REPLY,
  buildRetrievalPrompt,
} from "@/lib/rag/prompt";
import {
  getChatModel,
  resolveChatModelConfig,
  type ChatModelConfig,
} from "@/lib/rag/model";
import { appendMessage } from "@/lib/chat/persistence";
import { sanitizeChatMessages } from "@/lib/chat/sanitize";
import { uiMessageText } from "@/lib/chat/messageText";

// Why: streaming works fine on the Node runtime and matches the rest of the
// app. Edge would trim a bit of latency but complicates pdf-parse in ingest,
// which we already ruled out. Stay consistent across routes.
export const runtime = "nodejs";
// Why: model generation can take up to ~30s for a long answer + retrieval overhead.
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return unauthenticated();

  const minuteCheck = await checkRateLimit(
    BUCKETS.chatMinute,
    user.id,
    CHAT_LIMITS.perMinute,
    60_000,
  );
  if (!minuteCheck.ok) {
    return tooMany(minuteCheck.retryAfterSec, "Too many messages. Slow down.");
  }

  const dayCheck = await checkRateLimit(
    BUCKETS.chatDay,
    user.id,
    CHAT_LIMITS.perDay,
    24 * 60 * 60_000,
  );
  if (!dayCheck.ok) {
    return tooMany(dayCheck.retryAfterSec, "Daily message limit reached.");
  }

  let body: { messages?: unknown; conversationId?: unknown };
  try {
    body = (await request.json()) as {
      messages?: unknown;
      conversationId?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Why: which model answers (OpenAI or a self-hosted OpenAI-compatible
  // server) is an env decision — see src/lib/rag/model.ts. Resolve it before
  // sanitizing because a small-context model tightens the history budget. A
  // bad value is an operator error: log the exact reason, stay generic to the
  // client.
  let modelConfig: ChatModelConfig;
  try {
    modelConfig = resolveChatModelConfig();
  } catch (err) {
    console.error("[chat] invalid chat model configuration", err);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }

  // Why: the history is client-controlled. Sanitizing bounds message count and
  // total size (token-cost cap) and drops client-supplied `system` roles so
  // the only system prompt the model sees is ours.
  const messages = sanitizeChatMessages(body.messages, {
    maxHistoryChars: modelConfig.maxHistoryChars,
  });
  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  // Why: conversationId is required so we can persist turns to the right thread.
  // Validate shape early so scanners spamming garbage don't hit Prisma.
  const conversationId = body.conversationId;
  if (typeof conversationId !== "string" || !ID_RE.test(conversationId)) {
    return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
  }

  // Why: the retrieval query is the latest user message. Assistant messages
  // don't drive new searches; the model uses the full turn history for context.
  const latest = [...messages].reverse().find((m) => m.role === "user");
  const question = latest ? uiMessageText(latest) : "";

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

    // Why: a brand-new conversation with nothing retrievable (typically a user
    // with no matching documents) has exactly one correct answer — the canned
    // "not in your documents" reply. Skip the model call and stream it
    // directly: saves a full LLM round-trip per empty first turn. Multi-turn
    // conversations still go to the model so follow-ups can use history.
    if (chunks.length === 0 && messages.length === 1) {
      await appendMessage({
        conversationId,
        userId: user.id,
        role: "user",
        content: question,
      });
      await appendMessage({
        conversationId,
        userId: user.id,
        role: "assistant",
        content: NO_SOURCES_REPLY,
      });
      const stream = createUIMessageStream({
        execute: ({ writer }) => {
          writer.write({ type: "text-start", id: "canned" });
          writer.write({ type: "text-delta", id: "canned", delta: NO_SOURCES_REPLY });
          writer.write({ type: "text-end", id: "canned" });
        },
      });
      return createUIMessageStreamResponse({ stream });
    }

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

    // Why: persist the user turn BEFORE streaming so it survives even if the
    // model call fails halfway. This is cheap (~1 DB round-trip) and prevents
    // the ugly case where an answer half-streams and then vanishes with its
    // prompt on refresh.
    await appendMessage({
      conversationId,
      userId: user.id,
      role: "user",
      content: question,
    });

    const result = streamText({
      model: getChatModel(modelConfig),
      system: SYSTEM_PROMPT,
      messages: modelMessages,
      // Why: pinned so every provider — and every offline eval — samples the
      // same way. See the constants in src/lib/rag/prompt.ts.
      temperature: CHAT_TEMPERATURE,
      maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      // Why: onFinish fires once when the stream completes cleanly. Persist
      // the assistant reply here so the full turn is durable.
      onFinish: async ({ text }) => {
        try {
          await appendMessage({
            conversationId,
            userId: user.id,
            role: "assistant",
            content: text,
          });
        } catch (err) {
          // Non-fatal — the client already got the stream. Log for debugging.
          console.error("[chat] failed to persist assistant reply", err);
        }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.error("[chat] failed", err);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}
