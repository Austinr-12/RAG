"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat, type UseChatOptions } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { MessageBubble } from "./MessageBubble";

// Why: initialMessages come from the server as plain {role, content, id}.
// v7 UIMessage requires a `parts` array — hydrate them into TextUIParts here.
type StoredMsg = { id: string; role: "user" | "assistant" | "system"; content: string };

type Props = {
  conversationId: string;
  initialMessages: StoredMsg[];
};

export function ChatPanel({ conversationId, initialMessages }: Props) {
  const router = useRouter();
  const [creatingNew, setCreatingNew] = useState(false);

  const hydrated: UIMessage[] = initialMessages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text", text: m.content }],
  }));

  // Why: keying useChat by conversationId means the hook fully resets when we
  // switch to a new conversation (via "New chat" below). `messages` is the
  // initial-state option in v7 (not `initialMessages`).
  const chatOptions: UseChatOptions<UIMessage> = {
    id: conversationId,
    messages: hydrated,
    // Why: sendMessage POSTs to /api/chat with the message list. Adding
    // conversationId here means the server can persist to the right thread.
    // The body prop is a top-level ChatInit option in v7.
    body: { conversationId },
  } as UseChatOptions<UIMessage>;

  const { messages, sendMessage, status, error, stop } = useChat(chatOptions);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, status]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    await sendMessage({ text });
  }

  async function newChat() {
    if (creatingNew) return;
    setCreatingNew(true);
    try {
      const res = await fetch("/api/conversations", { method: "POST" });
      if (!res.ok) throw new Error(`Create failed (${res.status})`);
      // Why: server-render the new empty conversation so message state resets
      // cleanly. router.refresh() re-fetches the server component's data.
      router.refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setCreatingNew(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem-6rem)] flex-col rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <span className="text-xs uppercase tracking-wide text-zinc-500">
          {messages.length === 0 ? "New conversation" : `${messages.length} messages`}
        </span>
        <button
          type="button"
          onClick={() => void newChat()}
          disabled={creatingNew || messages.length === 0}
          className="rounded-full px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {creatingNew ? "Creating…" : "New chat"}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6"
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
        {busy && messages[messages.length - 1]?.role === "user" && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
              <TypingDots />
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error.message || "Something went wrong. Try again."}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
      >
        <div className="flex items-end gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 focus-within:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus-within:border-zinc-600">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit(e);
              }
            }}
            placeholder="Ask a question about your documents…"
            rows={1}
            className="flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-zinc-400"
            style={{ minHeight: "1.5rem", maxHeight: "10rem" }}
          />
          {busy ? (
            <button
              type="button"
              onClick={() => stop()}
              className="inline-flex h-8 items-center rounded-full bg-zinc-200 px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="inline-flex h-8 items-center rounded-full bg-zinc-900 px-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Send
            </button>
          )}
        </div>
        <p className="mt-2 px-1 text-xs text-zinc-500">
          Answers are generated from your uploaded documents only. Enter to send,
          Shift+Enter for a new line.
        </p>
      </form>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden
        >
          <path d="M21 12a8 8 0 1 1-3.3-6.5" />
          <path d="M21 5v4h-4" />
          <path d="M8 12h.01M12 12h.01M16 12h.01" />
        </svg>
      </div>
      <h2 className="mt-4 text-base font-medium">Ask about your documents</h2>
      <p className="mt-1 max-w-sm text-sm text-zinc-500">
        Questions are answered from your uploads only. Every fact is cited with
        a direct quote from the source.
      </p>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
    </span>
  );
}
