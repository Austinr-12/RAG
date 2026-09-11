import { describe, expect, it } from "vitest";
import { aggregate, chunkMatches, normalize, scoreRetrieval } from "./metrics";
import type { EvalQuestion } from "./questions";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

function chunk(content: string, similarity = 0.5): RetrievedChunk {
  return {
    chunkId: "c",
    content,
    index: 0,
    documentId: "d",
    documentName: "Doc",
    similarity,
  };
}

const q: EvalQuestion = {
  id: "q1",
  question: "What is the price?",
  expectedSubstrings: ["$2,899"],
};

describe("normalize / chunkMatches", () => {
  it("survives case and whitespace differences", () => {
    expect(normalize("  The\n PRICE is\t$2,899 ")).toBe("the price is $2,899");
    expect(chunkMatches(chunk("price:\n $2,899 total"), q)).toBe(true);
    expect(chunkMatches(chunk("no price here"), q)).toBe(false);
  });
});

describe("scoreRetrieval", () => {
  it("records the 1-indexed rank of the first matching chunk", () => {
    const r = scoreRetrieval(q, [chunk("miss"), chunk("$2,899"), chunk("$2,899 again")]);
    expect(r.hit).toBe(true);
    expect(r.rank).toBe(2);
  });

  it("reports a miss as rank null", () => {
    const r = scoreRetrieval(q, [chunk("nope")]);
    expect(r.hit).toBe(false);
    expect(r.rank).toBeNull();
  });

  it("handles empty retrieval", () => {
    const r = scoreRetrieval(q, []);
    expect(r.hit).toBe(false);
    expect(r.topSimilarity).toBeNull();
    expect(r.topContent).toBe("");
  });
});

describe("aggregate", () => {
  it("computes hit@K and MRR", () => {
    const results = [
      scoreRetrieval(q, [chunk("$2,899", 0.8)]), // rank 1 → RR 1
      scoreRetrieval(q, [chunk("miss", 0.4), chunk("$2,899", 0.3)]), // rank 2 → RR 0.5
      scoreRetrieval(q, [chunk("miss", 0.2)]), // miss → RR 0
    ];
    const m = aggregate(results);
    expect(m.n).toBe(3);
    expect(m.hitAtK).toBeCloseTo(2 / 3);
    expect(m.mrr).toBeCloseTo((1 + 0.5 + 0) / 3);
    expect(m.meanTopSimilarity).toBeCloseTo((0.8 + 0.4 + 0.2) / 3);
  });

  it("returns zeros for an empty set", () => {
    expect(aggregate([])).toEqual({ n: 0, hitAtK: 0, mrr: 0, meanTopSimilarity: 0 });
  });
});
