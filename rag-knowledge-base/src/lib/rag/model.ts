import { createOpenAI, openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { MAX_HISTORY_CHARS } from "@/lib/chat/sanitize";
import { CHAT_MODEL } from "@/lib/rag/prompt";

// Why: the answer generator is swappable by env so a self-hosted, fine-tuned
// model (vLLM or any OpenAI-compatible server) can replace gpt-4o-mini with
// zero changes to the route or the UI. Three traps this module exists to avoid:
//
//   1. `openai("id")` in @ai-sdk/openai v4 targets the Responses API
//      (/v1/responses). Self-hosted servers implement Chat Completions, so the
//      custom path must go through `.chat()` or every request 404s.
//   2. OPENAI_BASE_URL is NOT the switch. Both @ai-sdk/openai and the official
//      `openai` SDK (src/lib/openai.ts, used for embeddings) read it, so
//      setting it would redirect embedding calls to the chat server and break
//      retrieval. The switch is the dedicated CHAT_* variables below.
//   3. createOpenAI() falls back to OPENAI_API_KEY when no apiKey is passed —
//      which would send the real OpenAI key to a third-party host. The custom
//      path therefore ALWAYS passes an explicit key, a placeholder if needed.
//
// Env:
//   CHAT_BASE_URL            e.g. http://localhost:8000/v1 (must include /v1).
//                            Unset → OpenAI gpt-4o-mini, exactly as before.
//   CHAT_MODEL_ID            required with CHAT_BASE_URL; the served model name.
//   CHAT_API_KEY             optional bearer token for the custom server.
//   CHAT_MAX_HISTORY_CHARS   optional tighter history budget for small-context
//                            models (see sanitizeChatMessages).

export const CUSTOM_PROVIDER_NAME = "rag-custom";
const PLACEHOLDER_API_KEY = "not-needed";

type Env = Record<string, string | undefined>;

export type ChatModelConfig =
  | { provider: "openai"; modelId: string; maxHistoryChars: number }
  | {
      provider: "custom";
      modelId: string;
      baseURL: string;
      apiKey: string;
      maxHistoryChars: number;
    };

// Why: distinct class so the route can log a precise "fix your env" message
// instead of a generic chat failure.
export class ChatModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatModelConfigError";
  }
}

/**
 * Pure env → config mapping (no provider is constructed), so every branch is
 * unit-testable. Resolved per request rather than at module scope because
 * process.env is only reliably populated at request time in Next 16 — the same
 * reason src/lib/openai.ts builds its client lazily.
 */
export function resolveChatModelConfig(env: Env = process.env): ChatModelConfig {
  const maxHistoryChars = parseHistoryBudget(env.CHAT_MAX_HISTORY_CHARS);

  const baseURL = env.CHAT_BASE_URL?.trim();
  if (!baseURL) {
    return { provider: "openai", modelId: CHAT_MODEL, maxHistoryChars };
  }

  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new ChatModelConfigError("CHAT_BASE_URL is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ChatModelConfigError("CHAT_BASE_URL must be an http(s) URL");
  }

  const modelId = env.CHAT_MODEL_ID?.trim();
  if (!modelId) {
    throw new ChatModelConfigError(
      "CHAT_MODEL_ID is required when CHAT_BASE_URL is set",
    );
  }

  return {
    provider: "custom",
    modelId,
    baseURL,
    apiKey: env.CHAT_API_KEY?.trim() || PLACEHOLDER_API_KEY,
    maxHistoryChars,
  };
}

function parseHistoryBudget(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return MAX_HISTORY_CHARS;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ChatModelConfigError(
      "CHAT_MAX_HISTORY_CHARS must be a positive integer",
    );
  }
  return Math.min(n, MAX_HISTORY_CHARS);
}

/** Build the AI SDK model for a resolved config. */
export function getChatModel(
  config: ChatModelConfig = resolveChatModelConfig(),
): LanguageModel {
  if (config.provider === "openai") return openai(config.modelId);

  const provider = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    name: CUSTOM_PROVIDER_NAME,
  });
  return provider.chat(config.modelId);
}
