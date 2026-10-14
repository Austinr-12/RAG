import { normalizeChunkText } from "@/lib/rag/prompt";

// Why: SYSTEM_PROMPT rule 2 tells the model to cite with
//   > **{Document Name}** — {exact quoted text, ≤ 200 characters}
// but until now nothing in the codebase could check whether a reply actually
// followed that format — MessageBubble styles any line starting with "> ".
// This module is the executable spec: the generation eval scores replies with
// it, and the prompt contract exports the pattern so the fine-tuning pipeline
// filters and evaluates against the exact same rule. Pure — no DB, no network.

export const MAX_QUOTE_CHARS = 200;

// Why: models often wrap the quoted text in quotation marks (gpt-4o-mini did it
// on every answer of the 2026-10-13 in-app eval). The text inside is exact and
// the UI renders both forms the same, so the verifier strips ONE pair of
// wrapping quotation marks before the substring check. `verbatimStrict` keeps
// the no-stripping verdict so evaluations can report both numbers. The pairs
// are exported through the contract so the Python side applies the same list.
export const QUOTE_WRAPPER_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["“", "”"], // “ ”
  ["‘", "’"], // ‘ ’
  ["'", "'"],
  ["«", "»"], // « »
  ["„", "“"], // „ “
];

/** Remove one pair of matching wrapping quotation marks, if present. */
export function stripWrappingQuotes(quote: string): string {
  const q = quote.trim();
  if (q.length < 3) return q;
  for (const [open, close] of QUOTE_WRAPPER_PAIRS) {
    if (q.startsWith(open) && q.endsWith(close)) {
      return q.slice(open.length, q.length - close.length).trim();
    }
  }
  return q;
}

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
  /**
   * The quote, after removing one pair of wrapping quotation marks, appears
   * verbatim in a chunk of THAT document, as prompted. This is what `valid`
   * uses.
   */
  verbatim: boolean;
  /** Same check without removing wrapping quotation marks. Reported, not gating. */
  verbatimStrict: boolean;
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
  const texts = named.map((s) => normalizeChunkText(s.content));
  const strictQuote = normalizeChunkText(citation.quote);
  const quote = normalizeChunkText(stripWrappingQuotes(citation.quote));
  const knownDocument = named.length > 0;
  const verbatimStrict =
    strictQuote.length > 0 && texts.some((t) => t.includes(strictQuote));
  const verbatim = quote.length > 0 && texts.some((t) => t.includes(quote));
  const withinLength = quote.length <= MAX_QUOTE_CHARS;
  return {
    knownDocument,
    verbatim,
    verbatimStrict,
    withinLength,
    valid: knownDocument && verbatim && withinLength,
  };
}
