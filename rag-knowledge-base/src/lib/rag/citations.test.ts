import { describe, expect, it } from "vitest";
import {
  MAX_QUOTE_CHARS,
  extractCitations,
  parseCitationLine,
  verifyCitation,
} from "./citations";
import { SYSTEM_PROMPT } from "./prompt";

describe("parseCitationLine", () => {
  it("parses the documented format", () => {
    expect(
      parseCitationLine("> **handbook.md** — The warranty lasts one year."),
    ).toEqual({
      documentName: "handbook.md",
      quote: "The warranty lasts one year.",
    });
  });

  it("handles document names and quotes that contain an em-dash", () => {
    const c = parseCitationLine(
      "> **Aurora Notebook — Owner's Handbook** — Aurora Notebook Pro (model code ANP-C3) — 16.2\" display",
    );
    expect(c?.documentName).toBe("Aurora Notebook — Owner's Handbook");
    expect(c?.quote).toBe('Aurora Notebook Pro (model code ANP-C3) — 16.2" display');
  });

  it("parses the example line embedded in the system prompt", () => {
    const example = SYSTEM_PROMPT.split("\n").at(-1)!;
    expect(parseCitationLine(example)?.documentName).toBe(
      "Aurora Notebook — Owner's Handbook",
    );
  });

  it("ignores trailing whitespace, as the UI does", () => {
    expect(parseCitationLine("> **a.pdf** — quoted   ")?.quote).toBe("quoted");
  });

  it.each([
    ["hyphen instead of em-dash", "> **a.pdf** - quoted"],
    ["en-dash instead of em-dash", "> **a.pdf** – quoted"],
    ["missing bold", "> a.pdf — quoted"],
    ["no space after the marker", ">**a.pdf** — quoted"],
    ["indented", "  > **a.pdf** — quoted"],
    ["empty quote", "> **a.pdf** — "],
    ["plain prose", "The warranty lasts one year."],
  ])("rejects %s", (_label, line) => {
    expect(parseCitationLine(line)).toBeNull();
  });
});

describe("extractCitations", () => {
  it("separates well-formed citations from malformed attempts", () => {
    const reply = [
      "The warranty lasts one year.",
      "> **handbook.md** — one-year limited warranty",
      "- a bullet, not a citation",
      "> **handbook.md** - wrong dash",
      "",
      "  > **handbook.md** — indented",
    ].join("\n");
    const scan = extractCitations(reply);
    expect(scan.citations).toEqual([
      { documentName: "handbook.md", quote: "one-year limited warranty" },
    ]);
    expect(scan.malformed).toHaveLength(2);
  });

  it("returns nothing for an abstention", () => {
    const scan = extractCitations(
      "I don't have anything about that in your uploaded documents.",
    );
    expect(scan).toEqual({ citations: [], malformed: [] });
  });

  it("tolerates CRLF line endings", () => {
    const scan = extractCitations("Answer.\r\n> **a.pdf** — quoted\r\n");
    expect(scan.citations).toEqual([{ documentName: "a.pdf", quote: "quoted" }]);
  });
});

describe("verifyCitation", () => {
  const sources = [
    { documentName: "handbook.md", content: "Covered by a\n  one-year   limited warranty." },
    { documentName: "faq.txt", content: "Call 1-800-287-6721 for support." },
  ];

  it("accepts a quote that is verbatim in the prompted (flattened) text", () => {
    expect(
      verifyCitation(
        { documentName: "handbook.md", quote: "a one-year limited warranty" },
        sources,
      ).valid,
    ).toBe(true);
  });

  it("rejects a paraphrase", () => {
    const v = verifyCitation(
      { documentName: "handbook.md", quote: "a 12-month warranty" },
      sources,
    );
    expect(v).toMatchObject({ knownDocument: true, verbatim: false, valid: false });
  });

  it("rejects a real quote attributed to the wrong document", () => {
    const v = verifyCitation(
      { documentName: "handbook.md", quote: "Call 1-800-287-6721" },
      sources,
    );
    expect(v).toMatchObject({ knownDocument: true, verbatim: false, valid: false });
  });

  it("rejects an invented document name", () => {
    const v = verifyCitation(
      { documentName: "Handbook", quote: "one-year limited warranty" },
      sources,
    );
    expect(v).toMatchObject({ knownDocument: false, valid: false });
  });

  it("enforces the quote length cap", () => {
    const long = "x".repeat(MAX_QUOTE_CHARS + 1);
    const v = verifyCitation({ documentName: "big.txt", quote: long }, [
      { documentName: "big.txt", content: long },
    ]);
    expect(v).toMatchObject({ verbatim: true, withinLength: false, valid: false });
  });
});

describe("spec consistency", () => {
  it("keeps MAX_QUOTE_CHARS in sync with the limit stated in the system prompt", () => {
    expect(SYSTEM_PROMPT).toContain(`≤ ${MAX_QUOTE_CHARS} characters`);
  });
});
