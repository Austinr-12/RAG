// Why: in-memory limiter is per-process — fine for dev and single-instance deploys.
// For multi-instance prod (Vercel serverless, Fly multi-region), swap in Upstash
// Ratelimit or Redis so buckets are shared. The API here mirrors Upstash's so the
// call sites don't need to change.

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

type WindowState = { count: number; resetAt: number };

const buckets = new Map<string, WindowState>();

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSec: number };

export function checkRateLimit(
  bucket: string,
  id: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
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
}

// Why: bucket names are the primary axis of separation, so exported as constants
// to avoid typo-drift between callers.
export const BUCKETS = {
  uploadMinute: "upload:min",
  uploadDay: "upload:day",
  readMinute: "read:min",
  chatMinute: "chat:min",
  chatDay: "chat:day",
} as const;
