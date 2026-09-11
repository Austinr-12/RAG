import { describe, expect, it } from "vitest";
import { buildRetrievalPrompt, NO_SOURCES_REPLY } from "./prompt";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

function chunk(name: string, content: string): RetrievedChunk {
  return {
    chunkId: "c",
    content,
    index: 0,
    documentId: "d",
    documentName: name,
    similarity: 0.5,
  };
}

describe("buildRetrievalPrompt", () => {
  it("numbers sources with their document names and appends the question", () => {
    const p = buildRetrievalPrompt("What is the price?", [
      chunk("Handbook", "The price   is\n$2,899."),
      chunk("FAQ", "Support number is 1-800."),
    ]);
    expect(p).toContain("[1] Handbook");
    expect(p).toContain("[2] FAQ");
    // Chunk whitespace is flattened for prompt compactness.
    expect(p).toContain("The price is $2,899.");
    expect(p).toContain("Question: What is the price?");
  });

  it("signals an explicit empty-sources state", () => {
    const p = buildRetrievalPrompt("Anything?", []);
    expect(p).toContain("none");
    expect(p).toContain("Question: Anything?");
  });

  it("exports a canned no-sources reply for the short-circuit path", () => {
    expect(NO_SOURCES_REPLY.length).toBeGreaterThan(0);
  });
});
