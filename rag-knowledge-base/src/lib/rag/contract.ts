import { createHash } from "node:crypto";
import { CHUNK_OVERLAP, CHUNK_SIZE } from "@/lib/rag/chunking";
import {
  CITATION_LINE_PATTERN,
  MAX_QUOTE_CHARS,
  extractCitations,
  verifyCitation,
  type CitationSource,
} from "@/lib/rag/citations";
import {
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_TEMPERATURE,
  NO_SOURCES_REPLY,
  SYSTEM_PROMPT,
  buildRetrievalPrompt,
  normalizeChunkText,
} from "@/lib/rag/prompt";
import { RETRIEVE_DEFAULT_K } from "@/lib/rag/retrievalConfig";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

// Why: a model fine-tuned to replace gpt-4o-mini is only valid for THIS app if
// it was trained and evaluated on byte-identical inputs: the same system
// prompt, the same rendered sources block, the same citation rule, the same
// sampling. The training pipeline lives outside this package (Python), so
// instead of re-typing any of that over there, this module serializes it into
// contract/prompt-contract.json and the pipeline reads the file.
//
// Two guards keep the file honest:
//   - contract.test.ts fails when the file no longer matches this module, so
//     editing prompt.ts without re-exporting breaks `npm test`.
//   - The golden samples let the consumer prove its own prompt renderer and
//     citation checker reproduce this app's behavior exactly.
// Datasets and model cards record `sha256`; a model matches the app only when
// the hashes match.
//
// Pure: no DB, no network, no env. Regenerate with `npm run export:contract`.

export const CONTRACT_RELATIVE_PATH = "contract/prompt-contract.json";

// Bump when the SHAPE of the contract changes (not when values change — value
// changes are what `sha256` is for).
export const CONTRACT_VERSION = 1;

type GoldenSource = { documentName: string; content: string; normalized: string };

export type PromptContract = {
  contractVersion: number;
  description: string[];
  systemPrompt: string;
  noSourcesReply: string;
  citation: { linePattern: string; maxQuoteChars: number };
  chunking: { chunkSize: number; chunkOverlap: number };
  retrieval: { topK: number };
  generation: { temperature: number; maxOutputTokens: number };
  goldenPrompts: Array<{
    name: string;
    question: string;
    sources: GoldenSource[];
    rendered: string;
  }>;
  goldenCitations: Array<{
    name: string;
    reply: string;
    sources: CitationSource[];
    expected: {
      citations: Array<{
        documentName: string;
        quote: string;
        knownDocument: boolean;
        verbatim: boolean;
        withinLength: boolean;
        valid: boolean;
      }>;
      malformedCount: number;
    };
  }>;
  sha256: string;
};

const DESCRIPTION = [
  "Generated from rag-knowledge-base/src/lib/rag by `npm run export:contract`. Do not edit by hand.",
  "Message layout sent to the chat model: system = systemPrompt; the LATEST user turn = a rendered retrieval prompt (see goldenPrompts[].rendered); earlier user turns are the raw questions and earlier assistant turns are prior replies, unmodified.",
  "When a brand-new conversation retrieves zero chunks the app replies with noSourcesReply and never calls the model.",
  "Rendered prompts use sources[].normalized (whitespace flattened by the app). Consumers should use the normalized text as given instead of re-implementing the normalization.",
  "A citation is valid when its line matches citation.linePattern, the document name exactly equals a source name in the prompt, the quote is a substring of that document's normalized text, and the quote is at most citation.maxQuoteChars long.",
  "sha256 = SHA-256 (hex) of JSON.stringify of this object without the sha256 key, keys in file order.",
];

function chunk(documentName: string, content: string): RetrievedChunk {
  return {
    chunkId: "golden",
    content,
    index: 0,
    documentId: "golden",
    documentName,
    similarity: 0,
  };
}

// Fixed inputs. They deliberately cover: messy whitespace (newlines, tabs, a
// non-breaking space), filename-style and title-style document names, a name
// containing an em-dash, the same document appearing in several chunks, a full
// top-K context, and the empty-sources prompt.
const GOLDEN_PROMPT_INPUTS: Array<{
  name: string;
  question: string;
  sources: Array<{ documentName: string; content: string }>;
}> = [
  {
    name: "two-documents-messy-whitespace",
    question: "How long is the warranty and who do I call?",
    sources: [
      {
        documentName: "aurora-notebook-handbook.md",
        content:
          "## Warranty\n\nEvery Aurora Notebook is covered by a\n  one-year   limited warranty\tfrom the date of purchase.\n",
      },
      {
        documentName: "support-faq.txt",
        content: "  Phone support: 1-800-287-6721 (Mon–Fri, 8am–8pm ET).  ",
      },
    ],
  },
  {
    name: "full-top-k-repeated-document",
    question: "What is the price of the Pro model?",
    sources: [
      {
        documentName: "Aurora Notebook — Owner's Handbook",
        content:
          'Aurora Notebook Pro (model code ANP-C3) — 16.2" display, 64 GB RAM, 2 TB SSD, dedicated GPU. Starting price $2,899.',
      },
      {
        documentName: "Aurora Notebook — Owner's Handbook",
        content:
          "Starting price $2,899.\n\n## Battery\n\nThe battery is rated for 1,000 full charge cycles.",
      },
      {
        documentName: "pricing_2025-Q3.pdf",
        content: "Résumé of list prices — all “Pro” configurations ship with AuroraCare+.",
      },
      {
        documentName: "aurora-notebook-handbook.md",
        content: "- **Aurora Notebook 13** (model code AN13-A1) — 13.4\" display. Starting price $1,299.",
      },
      {
        documentName: "notes.txt",
        content: "Unrelated meeting notes.\r\nNothing about pricing here.",
      },
    ],
  },
  {
    name: "no-sources",
    question: "What is the capital of France?",
    sources: [],
  },
];

const GOLDEN_CITATION_INPUTS: Array<{
  name: string;
  reply: string;
  sources: CitationSource[];
}> = [
  {
    name: "valid-single-citation",
    reply:
      "The warranty lasts one year.\n> **aurora-notebook-handbook.md** — covered by a one-year limited warranty from the date of purchase",
    sources: [
      {
        documentName: "aurora-notebook-handbook.md",
        content:
          "Every Aurora Notebook is covered by a\n  one-year   limited warranty\tfrom the date of purchase.",
      },
    ],
  },
  {
    name: "em-dash-in-document-name-and-quote",
    reply:
      "The Pro starts at $2,899.\n> **Aurora Notebook — Owner's Handbook** — Aurora Notebook Pro (model code ANP-C3) — 16.2\" display",
    sources: [
      {
        documentName: "Aurora Notebook — Owner's Handbook",
        content:
          'Aurora Notebook Pro (model code ANP-C3) — 16.2" display, 64 GB RAM. Starting price $2,899.',
      },
    ],
  },
  {
    name: "paraphrase-wrong-document-and-invented-name",
    reply: [
      "Support is available by phone.",
      "> **support-faq.txt** — You can call support at 1-800-287-6721",
      "> **aurora-notebook-handbook.md** — Phone support: 1-800-287-6721",
      "> **Support FAQ** — Phone support: 1-800-287-6721",
      "> **support-faq.txt** — Phone support: 1-800-287-6721",
    ].join("\n"),
    sources: [
      { documentName: "aurora-notebook-handbook.md", content: "One-year limited warranty." },
      { documentName: "support-faq.txt", content: "Phone support: 1-800-287-6721 (Mon–Fri)." },
    ],
  },
  {
    name: "malformed-lines",
    reply: [
      "The warranty lasts one year.",
      "> **aurora-notebook-handbook.md** - One-year limited warranty.",
      "> aurora-notebook-handbook.md — One-year limited warranty.",
      "  > **aurora-notebook-handbook.md** — One-year limited warranty.",
      "- One-year limited warranty (a bullet, not a citation)",
    ].join("\n"),
    sources: [
      { documentName: "aurora-notebook-handbook.md", content: "One-year limited warranty." },
    ],
  },
  {
    name: "quote-over-length-cap",
    reply: `Long quote.\n> **big.txt** — ${"lorem ipsum ".repeat(20).trim()}`,
    sources: [{ documentName: "big.txt", content: "lorem ipsum ".repeat(30) }],
  },
  {
    name: "abstention",
    reply: "I don't have anything about that in your uploaded documents.",
    sources: [
      { documentName: "aurora-notebook-handbook.md", content: "One-year limited warranty." },
    ],
  },
];

export function buildContract(): PromptContract {
  const body = {
    contractVersion: CONTRACT_VERSION,
    description: DESCRIPTION,
    systemPrompt: SYSTEM_PROMPT,
    noSourcesReply: NO_SOURCES_REPLY,
    citation: {
      linePattern: CITATION_LINE_PATTERN,
      maxQuoteChars: MAX_QUOTE_CHARS,
    },
    chunking: { chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP },
    retrieval: { topK: RETRIEVE_DEFAULT_K },
    generation: {
      temperature: CHAT_TEMPERATURE,
      maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
    },
    goldenPrompts: GOLDEN_PROMPT_INPUTS.map((g) => ({
      name: g.name,
      question: g.question,
      sources: g.sources.map((s) => ({
        documentName: s.documentName,
        content: s.content,
        normalized: normalizeChunkText(s.content),
      })),
      rendered: buildRetrievalPrompt(
        g.question,
        g.sources.map((s) => chunk(s.documentName, s.content)),
      ),
    })),
    goldenCitations: GOLDEN_CITATION_INPUTS.map((g) => {
      const scan = extractCitations(g.reply);
      return {
        name: g.name,
        reply: g.reply,
        sources: g.sources,
        expected: {
          citations: scan.citations.map((c) => ({
            ...c,
            ...verifyCitation(c, g.sources),
          })),
          malformedCount: scan.malformed.length,
        },
      };
    }),
  };
  return { ...body, sha256: hashContractBody(body) };
}

export function hashContractBody(body: Omit<PromptContract, "sha256">): string {
  return createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex");
}

/** File form: pretty-printed, trailing newline, stable key order. */
export function serializeContract(contract: PromptContract): string {
  return `${JSON.stringify(contract, null, 2)}\n`;
}
