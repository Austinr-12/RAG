import { normalizeChunkText } from "@/lib/rag/prompt";

// Why: SYSTEM_PROMPT rule 2 tells the model to cite with
//   > **{Document Name}** — {exact quoted text, ≤ 200 characters}
// but until now nothing in the codebase could check whether a reply actually
// followed that format — MessageBubble styles any line starting with "> ".
// This module is the executable spec: the generation eval scores replies with
// it, and the prompt contract exports the pattern so the fine-tuning pipeline
// filters and evaluates against the exact same rule. Pure — no DB, no network.

export const MAX_QUOTE_CHARS = 200;

// Kept as a pattern STRING (not only a RegExp) so it can be exported verbatim
// to non-JS consumers; the syntax is valid in both JS and Python `re`.
// The name group is lazy and the match anchors on the closing `**` because a
// document name can itself contain an em-dash ("Aurora Notebook — Owner's
// Handbook"), so " — " alone can't be the separator.
export const CITATION_LINE_PATTERN = "^> \\*\\*(.+?)\\*\\* — (.+)$";
const CITATION_LINE_RE = new RegExp(CITATION_LINE_PATTERN);

export type Citation = { documentName: string; quote: string };

/** Parse one line of a reply; null when it isn't a well-formed citation. */
export function parseCitationLine(line: string): Citation | null {
  const m = CITATION_LINE_RE.exec(line.trimEnd());
  if (!m) return null;
  return { documentName: m[1], quote: m[2] };
}

export type CitationScan = {
  citations: Citation[];
  /** Lines that look like a blockquote but don't match the citation format. */
  malformed: string[];
};

/**
 * Collect every citation in a reply. Any line whose first non-space character
 * is ">" is an attempted citation: it either parses or it's malformed (wrong
 * dash, missing bold, indented, no space after ">"). Format compliance for a
 * reply is simply `malformed.length === 0`.
 */
export function extractCitations(text: string): CitationScan {
  const citations: Citation[] = [];
  const malformed: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trimStart().startsWith(">")) continue;
    const parsed = parseCitationLine(line);
    if (parsed) citations.push(parsed);
    else malformed.push(line);
  }
  return { citations, malformed };
}

export type CitationSource = { documentName: string; content: string };

export type CitationVerdict = {
  /** The cited name exactly matches a document that was in the prompt. */
  knownDocument: boolean;
  /** The quote appears verbatim in a chunk of THAT document, as prompted. */
  verbatim: boolean;
  withinLength: boolean;
  valid: boolean;
};

/**
 * Check a citation against the sources the model was actually given. The
 * comparison runs on whitespace-normalized text because that is what
 * buildRetrievalPrompt shows the model — a quote can only be "verbatim"
 * relative to the text it was copied from.
 */
export function verifyCitation(
  citation: Citation,
  sources: CitationSource[],
): CitationVerdict {
  const named = sources.filter((s) => s.documentName === citation.documentName);
  const quote = normalizeChunkText(citation.quote);
  const knownDocument = named.length > 0;
  const verbatim =
    quote.length > 0 &&
    named.some((s) => normalizeChunkText(s.content).includes(quote));
  const withinLength = quote.length <= MAX_QUOTE_CHARS;
  return {
    knownDocument,
    verbatim,
    withinLength,
    valid: knownDocument && verbatim && withinLength,
  };
}
