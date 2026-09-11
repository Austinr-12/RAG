import OpenAI from "openai";

// Why: resolve the client lazily on first use, mirroring rateLimit.ts —
// process.env is only reliably populated at request time in Next 16, and a
// module-scope `new OpenAI()` throws at import time when OPENAI_API_KEY is
// absent (e.g. during builds), taking the whole route module down with it.
let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!client) {
    // The SDK reads OPENAI_API_KEY from the environment itself and applies
    // its own retry policy (2 retries with backoff on 429/5xx by default).
    client = new OpenAI();
  }
  return client;
}
