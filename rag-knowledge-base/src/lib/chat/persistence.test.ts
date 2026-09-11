import { describe, expect, it } from "vitest";
import { deriveTitle } from "./persistence";

describe("deriveTitle", () => {
  it("collapses whitespace to one line", () => {
    expect(deriveTitle("  what   is\nthe\twarranty?  ")).toBe("what is the warranty?");
  });

  it("keeps short titles untouched", () => {
    expect(deriveTitle("short question")).toBe("short question");
  });

  it("truncates long titles to 60 chars with an ellipsis", () => {
    const long = "w".repeat(200);
    const title = deriveTitle(long);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("…")).toBe(true);
  });

  it("does not add an ellipsis at exactly the limit", () => {
    const exact = "x".repeat(60);
    expect(deriveTitle(exact)).toBe(exact);
  });
});
