import { describe, expect, it } from "vitest";
import { buildTsQuery, reciprocalRankFusion, type Row } from "./hybrid";

describe("buildTsQuery", () => {
  it("OR-joins meaningful tokens", () => {
    expect(buildTsQuery("warranty length policy")).toBe(
      "warranty | length | policy",
    );
  });

  it("lowercases and drops 1-char tokens", () => {
    expect(buildTsQuery("A Warranty X b")).toBe("warranty");
  });

  it("strips tsquery metacharacters so user input can't break syntax", () => {
    const q = buildTsQuery(`'; DROP TABLE "Chunk"; ! & | ( ) :* <-> price`);
    expect(q).toBe("drop | table | chunk | price");
    for (const bad of ["!", "&", "(", ")", "'", ":", "<", ">", ";", '"']) {
      expect(q).not.toContain(bad);
    }
  });

  it("strips trailing plus (prefix operator) and leading hyphen (NOT)", () => {
    expect(buildTsQuery("AuroraCare+ -exclude")).toBe("auroracare | exclude");
  });

  it("keeps interior hyphens (model codes)", () => {
    expect(buildTsQuery("model AN13-A1")).toBe("model | an13-a1");
  });

  it("returns empty string when nothing survives", () => {
    expect(buildTsQuery("! @ # $ %")).toBe("");
    expect(buildTsQuery("")).toBe("");
  });
});

function row(chunkId: string): Row {
  return {
    chunkId,
    content: `content-${chunkId}`,
    index: 0,
    documentId: "doc",
    documentName: "Doc",
    similarity: 0,
  };
}

describe("reciprocalRankFusion", () => {
  it("promotes items appearing in multiple lists above single-list items", () => {
    const dense = [row("x"), row("y"), row("z")];
    const sparse = [row("y"), row("w")];
    const fused = reciprocalRankFusion([dense, sparse]);
    // y: 1/62 + 1/61 beats x: 1/61, w: 1/62, z: 1/63
    expect(fused.map((r) => r.chunkId)).toEqual(["y", "x", "w", "z"]);
  });

  it("dedupes by chunkId", () => {
    const fused = reciprocalRankFusion([[row("a")], [row("a")], [row("a")]]);
    expect(fused).toHaveLength(1);
    expect(fused[0].chunkId).toBe("a");
  });

  it("handles empty inputs", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  it("preserves row payloads from the first list containing the chunk", () => {
    const a = { ...row("a"), similarity: 0.9 };
    const fused = reciprocalRankFusion([[a], [{ ...row("a"), similarity: 0 }]]);
    expect(fused[0].similarity).toBe(0.9);
  });
});
