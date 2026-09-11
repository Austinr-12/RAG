import type { UIMessage } from "ai";

/**
 * Concatenate a UIMessage's text parts; non-text parts (tool calls,
 * reasoning, files) are ignored. Shared by the chat route (extracting the
 * retrieval question) and MessageBubble (rendering) so both sides agree on
 * what "the text of a message" means.
 */
export function uiMessageText(m: UIMessage): string {
  return (m.parts ?? [])
    .filter(
      (p): p is { type: "text"; text: string } =>
        !!p && p.type === "text" && typeof (p as { text?: unknown }).text === "string",
    )
    .map((p) => p.text)
    .join("");
}
