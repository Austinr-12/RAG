import type { RetrievedChunk } from "@/lib/rag/retrieve";

// Why: prompt construction is a pure function so it's trivially unit-testable
// (no OpenAI, no DB) and the exact instructions the model sees are auditable.

export const CHAT_MODEL = "gpt-4o-mini";

const NO_SOURCES_REPLY =
  "I don't have anything about that in your uploaded documents. Try uploading a relevant file, or ask a different question.";

/**
 * The system prompt instructs the model to answer strictly from the provided
 * sources and cite by immediately following any sourced sentence with a
 * markdown blockquote in a fixed format. The UI parses those blockquotes to
 * render them as highlighted citations.
 */
export const SYSTEM_PROMPT = `You are a helpful research assistant answering questions about the user's uploaded documents.

RULES:
1. Answer ONLY from the provided sources. If the sources do not contain enough information to answer, say so plainly and do not guess.
2. When you use a specific fact from a source, immediately follow the sentence with a markdown blockquote on its own line in this EXACT format:
   > **{Document Name}** — {the exact quoted text from that source, ≤ 200 characters}
3. Never invent document names or quotes. Only quote text that appears verbatim in the sources below.
4. Prefer short, direct answers. Use bullet points when listing multiple items.
5. If the user asks a follow-up that isn't covered by the sources, do not fall back to general knowledge — say the documents don't cover it.

Format example:
The Aurora Notebook Pro starts at $2,899 and includes a color-calibrated OLED panel.
> **Aurora Notebook — Owner's Handbook** — Aurora Notebook Pro (model code ANP-C3) — 16.2" display, 64 GB RAM, 2 TB SSD, dedicated GPU. Starting price $2,899.`;

/**
 * Build the user-facing turn: the retrieved context (numbered, with document
 * names) followed by the actual question. Returned as a single string so it
 * can be passed as `prompt` to streamText for a one-shot call, OR appended
 * to the message history for turn-based chat.
 */
export function buildRetrievalPrompt(
  question: string,
  chunks: RetrievedChunk[],
): string {
  if (chunks.length === 0) {
    // Why: even with an empty context we still give the model a clear directive
    // so it falls back to the "not in your documents" reply instead of guessing.
    return `Sources: (none — the user has no documents that match this question)

Question: ${question}

Answer:`;
  }

  const rendered = chunks
    .map((c, i) => {
      const trimmed = c.content.trim().replace(/\s+/g, " ");
      return `[${i + 1}] ${c.documentName}\n${trimmed}`;
    })
    .join("\n\n---\n\n");

  return `Sources:

${rendered}

Question: ${question}

Answer:`;
}

export { NO_SOURCES_REPLY };
