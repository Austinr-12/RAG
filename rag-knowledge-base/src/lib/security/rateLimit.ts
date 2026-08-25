// Why: rate limiting has two backends selected by env at module load:
//   - In-memory (default): a per-process Map. Fine for local dev and any
//     single-instance deploy. Data is lost on restart.
//   - Upstash Redis (opt-in): when UPSTASH_REDIS_REST_URL + _TOKEN are both
//     set, we route through Upstash's REST API. This is what production
//     serverless deploys (Vercel, Fly multi-region) need — otherwise each
//     container has its own bucket and an attacker hitting different
//     regions bypasses the caps.
//
// Both backends implement the same async `checkRateLimit` signature so call
// sites don't care which is active.
//
// The Upstash impl is deliberately zero-dep — a small `fetch` against their
// pipeline endpoint (INCR + EXPIRE with NX). If you outgrow this, drop in
// `@upstash/ratelimit` for their sliding-window algorithm.

export const UPLOAD_LIMITS = {
  perMinute: 5,
  perDay: 50,
  maxDocumentsPerUser: 100,
  maxChunksPerFile: 500,
} as const;

export const READ_LIMITS = {
  perMinute: 60,
} as const;

export const CHAT_LIMITS = {
  perMinute: 10,
  perDay: 200,
  maxMessageChars: 2000,
} as const;

export const BUCKETS = {
  uploadMinute: "upload:min",
  uploadDay: "upload:day",
  readMinute: "read:min",
  chatMinute: "chat:min",
  chatDay: "chat:day",
} as const;

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkRateLimit(
  bucket: string,
  id: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  return impl(bucket, id, limit, windowMs);
}

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

// Why: `process.env` is only reliably populated at request time in Next 16,
// so we resolve the impl lazily on the first call — not at module top-level.
let cachedImpl: RateLimiterFn | null = null;

type RateLimiterFn = (
  bucket: string,
  id: string,
  limit: number,
  windowMs: number,
) => Promise<RateLimitResult>;

async function impl(...args: Parameters<RateLimiterFn>): Promise<RateLimitResult> {
  if (!cachedImpl) {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (upstashUrl && upstashToken) {
      cachedImpl = makeUpstashLimiter(upstashUrl, upstashToken);
    } else {
      cachedImpl = inMemoryLimiter;
    }
  }
  return cachedImpl(...args);
}

// ---------------------------------------------------------------------------
// In-memory limiter (default)
// ---------------------------------------------------------------------------

type WindowState = { count: number; resetAt: number };
const buckets = new Map<string, WindowState>();

const inMemoryLimiter: RateLimiterFn = async (bucket, id, limit, windowMs) => {
  const key = `${bucket}:${id}`;
  const now = Date.now();
  const state = buckets.get(key);

  if (!state || state.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }

  if (state.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((state.resetAt - now) / 1000) };
  }

  state.count += 1;
  return { ok: true, remaining: limit - state.count };
};

// ---------------------------------------------------------------------------
// Upstash limiter (opt-in via env vars)
// ---------------------------------------------------------------------------

// Why: Upstash's `pipeline` endpoint runs multiple commands in a single round-trip.
// We use INCR + EXPIRE(NX). INCR is atomic; EXPIRE-with-NX only sets the TTL on
// the FIRST increment of the window, so subsequent hits don't extend it. That
// gives us a proper fixed-window without race conditions.
function makeUpstashLimiter(url: string, token: string): RateLimiterFn {
  return async (bucket, id, limit, windowMs) => {
    const key = `rl:${bucket}:${id}`;
    const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));

    try {
      const res = await fetch(`${url}/pipeline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          ["INCR", key],
          ["EXPIRE", key, String(ttlSec), "NX"],
          ["PTTL", key],
        ]),
        // Why: an unresponsive Upstash shouldn't wedge the request. Short
        // timeout + fail-open (see catch below) keeps the app usable while
        // still logging the outage.
        signal: AbortSignal.timeout(2000),
      });

      if (!res.ok) throw new Error(`Upstash ${res.status}`);
      const results = (await res.json()) as Array<{ result: number | string }>;
      const count = Number(results[0].result);
      const pttl = Number(results[2].result);

      if (count > limit) {
        const retryAfterSec =
          pttl > 0 ? Math.ceil(pttl / 1000) : ttlSec;
        return { ok: false, retryAfterSec };
      }
      return { ok: true, remaining: Math.max(0, limit - count) };
    } catch (err) {
      // Why: fail OPEN on Upstash outage — the app stays usable, rate limits
      // temporarily behave as no-op. Log so this is visible in monitoring.
      // The alternative (fail closed) would take the app down whenever
      // Upstash has a hiccup. Trade-off documented; adjust if your risk
      // model prefers fail-closed.
      console.error("[rateLimit] Upstash error, failing open", err);
      return { ok: true, remaining: limit };
    }
  };
}
