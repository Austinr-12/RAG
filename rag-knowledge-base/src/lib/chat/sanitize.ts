import type { UIMessage } from "ai";
import { uiMessageText } from "@/lib/chat/messageText";

// Why: the client sends the FULL message history on every POST. Before this
// module existed, only the latest user message had a length cap — a hostile
// client could ship megabytes of "history" (and arbitrary `system`-role
// messages) straight into the model call, amplifying token spend and
// overriding the RAG-only system prompt. Pure function so it's unit-testable
// without a request in flight.

/** Most recent messages kept per request — bounds per-call token spend. */
export const MAX_HISTORY_MESSAGES = 40;
/** Total character budget across all kept messages (~16k tokens). */
export const MAX_HISTORY_CHARS = 64_000;

/**
 * Normalize an untrusted `messages` payload into a bounded, text-only
 * history:
 *
 * - non-arrays and malformed entries are dropped
 * - only `user` / `assistant` roles survive — client-supplied `system`
 *   messages are discarded (the server sets its own system prompt)
 * - each message is reduced to a single text part (tool/file/reasoning
 *   parts from the wire are ignored, matching what the model call uses)
 * - history is trimmed oldest-first to MAX_HISTORY_MESSAGES and
 *   MAX_HISTORY_CHARS; the newest message always survives trimming
 */
export function sanitizeChatMessages(raw: unknown): UIMessage[] {
  if (!Array.isArray(raw)) return [];

  const cleaned: UIMessage[] = [];
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i] as {
      id?: unknown;
      role?: unknown;
      parts?: unknown;
    } | null;
    if (!m || typeof m !== "object") continue;
    const role =
      m.role === "user" || m.role === "assistant" ? m.role : null;
    if (!role) continue;
    if (!Array.isArray(m.parts)) continue;

    const text = uiMessageText(m as UIMessage);
    if (!text.trim()) continue;

    cleaned.push({
      id: typeof m.id === "string" && m.id ? m.id : `sanitized-${i}`,
      role,
      parts: [{ type: "text", text }],
    });
  }

  // Trim oldest-first: count + char budget, walking back from the newest.
  const recent = cleaned.slice(-MAX_HISTORY_MESSAGES);
  let budget = MAX_HISTORY_CHARS;
  let start = recent.length;
  while (start > 0) {
    const cost = uiMessageText(recent[start - 1]).length;
    // Always keep the newest message, even if it alone exceeds the budget —
    // the route applies its own per-message length cap with a clear 413.
    if (cost > budget && start !== recent.length) break;
    budget -= cost;
    start -= 1;
  }
  return recent.slice(start);
}
