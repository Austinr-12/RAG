import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import { MAX_HISTORY_CHARS } from "@/lib/chat/sanitize";
import {
  CUSTOM_PROVIDER_NAME,
  ChatModelConfigError,
  getChatModel,
  resolveChatModelConfig,
} from "./model";
import { CHAT_MAX_OUTPUT_TOKENS, CHAT_MODEL, CHAT_TEMPERATURE } from "./prompt";

const CUSTOM_ENV = {
  CHAT_BASE_URL: "http://localhost:8000/v1",
  CHAT_MODEL_ID: "rag-grounded-4b",
};

describe("resolveChatModelConfig", () => {
  it("defaults to OpenAI when CHAT_BASE_URL is unset or blank", () => {
    for (const env of [{}, { CHAT_BASE_URL: "" }, { CHAT_BASE_URL: "   " }]) {
      expect(resolveChatModelConfig(env)).toEqual({
        provider: "openai",
        modelId: CHAT_MODEL,
        maxHistoryChars: MAX_HISTORY_CHARS,
      });
    }
  });

  it("ignores a leftover CHAT_MODEL_ID so commenting out CHAT_BASE_URL switches back", () => {
    const cfg = resolveChatModelConfig({ CHAT_MODEL_ID: "rag-grounded-4b" });
    expect(cfg).toMatchObject({ provider: "openai", modelId: CHAT_MODEL });
  });

  it("switches to the custom provider when CHAT_BASE_URL is set", () => {
    expect(
      resolveChatModelConfig({ ...CUSTOM_ENV, CHAT_API_KEY: " secret " }),
    ).toEqual({
      provider: "custom",
      modelId: "rag-grounded-4b",
      baseURL: "http://localhost:8000/v1",
      apiKey: "secret",
      maxHistoryChars: MAX_HISTORY_CHARS,
    });
  });

  it("never falls back to the OpenAI key for a custom endpoint", () => {
    const cfg = resolveChatModelConfig({
      ...CUSTOM_ENV,
      OPENAI_API_KEY: "sk-real-openai-key",
    });
    expect(cfg.provider).toBe("custom");
    if (cfg.provider === "custom") {
      expect(cfg.apiKey).not.toContain("sk-real-openai-key");
      expect(cfg.apiKey.length).toBeGreaterThan(0);
    }
  });

  it("is not switched by OPENAI_BASE_URL (that variable is shared with embeddings)", () => {
    const cfg = resolveChatModelConfig({
      OPENAI_BASE_URL: "http://localhost:8000/v1",
    });
    expect(cfg.provider).toBe("openai");
  });

  it("requires CHAT_MODEL_ID with a custom endpoint", () => {
    expect(() =>
      resolveChatModelConfig({ CHAT_BASE_URL: CUSTOM_ENV.CHAT_BASE_URL }),
    ).toThrow(ChatModelConfigError);
  });

  it.each(["not a url", "ftp://host/v1", "localhost:8000/v1"])(
    "rejects invalid CHAT_BASE_URL %j",
    (url) => {
      expect(() =>
        resolveChatModelConfig({ ...CUSTOM_ENV, CHAT_BASE_URL: url }),
      ).toThrow(ChatModelConfigError);
    },
  );

  it("parses and clamps CHAT_MAX_HISTORY_CHARS", () => {
    expect(
      resolveChatModelConfig({ CHAT_MAX_HISTORY_CHARS: "16000" }).maxHistoryChars,
    ).toBe(16_000);
    expect(
      resolveChatModelConfig({ CHAT_MAX_HISTORY_CHARS: "999999999" })
        .maxHistoryChars,
    ).toBe(MAX_HISTORY_CHARS);
  });

  it.each(["0", "-1", "1.5", "abc"])(
    "rejects CHAT_MAX_HISTORY_CHARS=%j",
    (value) => {
      expect(() =>
        resolveChatModelConfig({ CHAT_MAX_HISTORY_CHARS: value }),
      ).toThrow(ChatModelConfigError);
    },
  );
});

describe("getChatModel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the OpenAI Responses API by default", () => {
    const model = getChatModel(resolveChatModelConfig({}));
    expect(model).toMatchObject({
      provider: "openai.responses",
      modelId: CHAT_MODEL,
    });
  });

  it("uses Chat Completions for a custom endpoint", () => {
    const model = getChatModel(resolveChatModelConfig(CUSTOM_ENV));
    expect(model).toMatchObject({
      provider: `${CUSTOM_PROVIDER_NAME}.chat`,
      modelId: "rag-grounded-4b",
    });
  });

  it("calls <base>/chat/completions with the pinned sampling and no OpenAI key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-real-openai-key");
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            created: 0,
            model: "rag-grounded-4b",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { text } = await generateText({
      model: getChatModel(resolveChatModelConfig(CUSTOM_ENV)),
      system: "sys",
      prompt: "hi",
      temperature: CHAT_TEMPERATURE,
      maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
    });
    expect(text).toBe("ok");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/v1/chat/completions");

    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer not-needed");

    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("rag-grounded-4b");
    expect(body.temperature).toBe(CHAT_TEMPERATURE);
    expect(body.max_tokens ?? body.max_completion_tokens).toBe(
      CHAT_MAX_OUTPUT_TOKENS,
    );
    // Custom model ids must keep the plain `system` role — the `developer`
    // role is an OpenAI reasoning-model convention that vLLM doesn't accept.
    expect(body.messages[0]).toMatchObject({ role: "system", content: "sys" });

    vi.unstubAllEnvs();
  });
});
