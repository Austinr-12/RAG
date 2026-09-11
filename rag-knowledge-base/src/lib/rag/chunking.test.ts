import { describe, expect, it } from "vitest";
import { chunkText, CHUNK_OVERLAP, CHUNK_SIZE } from "./chunking";

describe("chunkText", () => {
  it("returns [] for empty input", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("returns a single chunk for short input", () => {
    expect(chunkText("hello world")).toEqual(["hello world"]);
  });

  it("never produces a chunk longer than chunkSize", () => {
    const paragraphs = Array.from(
      { length: 30 },
      (_, i) => `Paragraph ${i} with some sentences. More words follow here to pad it out.`,
    ).join("\n\n");
    for (const chunk of chunkText(paragraphs, { chunkSize: 80, chunkOverlap: 20 })) {
      expect(chunk.length).toBeLessThanOrEqual(80);
    }
  });

  it("splits unbroken text (no separators) by hard slicing", () => {
    const solid = "x".repeat(2500);
    const chunks = chunkText(solid, { chunkSize: 1000, chunkOverlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1000);
  });

  it("preserves every word of the input across chunks", () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`);
    const text = words.join(" ");
    const joined = chunkText(text, { chunkSize: 120, chunkOverlap: 30 }).join(" ");
    for (const w of words) expect(joined).toContain(w);
  });

  it("carries overlap from the previous chunk into the next", () => {
    const text = Array.from({ length: 40 }, (_, i) => `tok${i}`).join(" ");
    const chunks = chunkText(text, { chunkSize: 60, chunkOverlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    // The second chunk starts with the tail of the first (the overlap window).
    const tail = chunks[0].slice(-10);
    expect(chunks[1]).toContain(tail.trim().split(" ").pop() ?? "");
  });

  it("throws when overlap >= chunkSize", () => {
    expect(() => chunkText("abc", { chunkSize: 10, chunkOverlap: 10 })).toThrow();
  });

  it("default constants are sane", () => {
    expect(CHUNK_OVERLAP).toBeLessThan(CHUNK_SIZE);
  });
});
