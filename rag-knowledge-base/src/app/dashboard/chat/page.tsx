import { ChatPanel } from "@/components/chat/ChatPanel";
import { getOrCreateUser } from "@/lib/auth/getOrCreateUser";
import { getOrCreateActiveConversation } from "@/lib/chat/persistence";

// Why: this page is a server component so we can seed the client with the
// active conversation + its messages in the initial HTML. That removes a
// client-side round-trip and prevents the flash-of-empty-chat on refresh.
export default async function ChatPage() {
  const user = await getOrCreateUser();
  const conversation = await getOrCreateActiveConversation(user.id);

  // Server → client payload. Dates are serialized to strings so React can
  // pass them through as props without warnings.
  const initialMessages = conversation.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
  }));

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Chat</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Ask questions and get answers cited to the exact chunks that
            support them.
          </p>
        </div>
      </header>
      <ChatPanel
        conversationId={conversation.id}
        initialMessages={initialMessages}
      />
    </div>
  );
}
