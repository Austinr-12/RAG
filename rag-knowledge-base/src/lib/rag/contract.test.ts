import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_RELATIVE_PATH,
  buildContract,
  hashContractBody,
  type PromptContract,
} from "./contract";

const STALE_HINT =
  `${CONTRACT_RELATIVE_PATH} is missing or stale. Run \`npm run export:contract\`, ` +
  "review the diff, and remember: any model trained against the old sha256 no longer matches this app.";

const contractPath = path.resolve(process.cwd(), CONTRACT_RELATIVE_PATH);

function readContract(): PromptContract {
  expect(existsSync(contractPath), STALE_HINT).toBe(true);
  return JSON.parse(readFileSync(contractPath, "utf8")) as PromptContract;
}

describe("prompt contract", () => {
  it("the checked-in file matches the current prompt, citation and sampling code", () => {
    expect(readContract(), STALE_HINT).toEqual(buildContract());
  });

  it("carries a sha256 that a consumer can recompute from the file alone", () => {
    const { sha256, ...body } = readContract();
    expect(hashContractBody(body)).toBe(sha256);
  });

  it("is deterministic", () => {
    expect(buildContract()).toEqual(buildContract());
  });

  it("golden prompts cover the empty-sources case and a full top-K context", () => {
    const c = buildContract();
    const sizes = c.goldenPrompts.map((g) => g.sources.length);
    expect(sizes).toContain(0);
    expect(sizes).toContain(c.retrieval.topK);
  });

  it("golden prompts embed the normalized text, never the raw chunk", () => {
    for (const g of buildContract().goldenPrompts) {
      for (const s of g.sources) {
        expect(g.rendered).toContain(`${s.documentName}\n${s.normalized}`);
        expect(s.normalized).not.toMatch(/\s{2,}|[\n\t ]/);
      }
    }
  });

  it("golden citations exercise valid, invalid and malformed outcomes", () => {
    const all = buildContract().goldenCitations;
    const verdicts = all.flatMap((g) => g.expected.citations);
    expect(verdicts.some((v) => v.valid)).toBe(true);
    expect(verdicts.some((v) => v.knownDocument && !v.verbatim)).toBe(true);
    expect(verdicts.some((v) => !v.knownDocument)).toBe(true);
    expect(verdicts.some((v) => v.verbatim && !v.withinLength)).toBe(true);
    expect(all.some((g) => g.expected.malformedCount > 0)).toBe(true);
    expect(
      all.some(
        (g) => g.expected.citations.length === 0 && g.expected.malformedCount === 0,
      ),
    ).toBe(true);
  });
});
