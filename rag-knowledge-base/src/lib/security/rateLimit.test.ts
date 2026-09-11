import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "./rateLimit";

// Why: no UPSTASH_* env vars in the test environment, so checkRateLimit
// resolves to the in-memory backend. Buckets are module-level state — every
// test uses a unique bucket name to stay isolated.
let n = 0;
const bucket = () => `test:${++n}`;

describe("in-memory rate limiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to the limit and then rejects", async () => {
    const b = bucket();
    expect((await checkRateLimit(b, "u1", 2, 60_000)).ok).toBe(true);
    expect((await checkRateLimit(b, "u1", 2, 60_000)).ok).toBe(true);
    const third = await checkRateLimit(b, "u1", 2, 60_000);
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.retryAfterSec).toBeGreaterThan(0);
      expect(third.retryAfterSec).toBeLessThanOrEqual(60);
    }
  });

  it("tracks users independently", async () => {
    const b = bucket();
    expect((await checkRateLimit(b, "u1", 1, 60_000)).ok).toBe(true);
    expect((await checkRateLimit(b, "u1", 1, 60_000)).ok).toBe(false);
    expect((await checkRateLimit(b, "u2", 1, 60_000)).ok).toBe(true);
  });

  it("resets after the window elapses", async () => {
    const b = bucket();
    expect((await checkRateLimit(b, "u1", 1, 60_000)).ok).toBe(true);
    expect((await checkRateLimit(b, "u1", 1, 60_000)).ok).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect((await checkRateLimit(b, "u1", 1, 60_000)).ok).toBe(true);
  });

  it("reports remaining capacity", async () => {
    const b = bucket();
    const first = await checkRateLimit(b, "u1", 5, 60_000);
    expect(first).toEqual({ ok: true, remaining: 4 });
    const second = await checkRateLimit(b, "u1", 5, 60_000);
    expect(second).toEqual({ ok: true, remaining: 3 });
  });
});
