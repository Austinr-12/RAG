import { ChatPanel } from "@/components/chat/ChatPanel";

export default function ChatPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Chat</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Ask questions and get answers cited to the exact chunks that support
          them.
        </p>
      </header>
      <ChatPanel />
    </div>
  );
}
