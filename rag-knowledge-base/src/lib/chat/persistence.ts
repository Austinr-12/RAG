import { prisma } from "@/lib/prisma";

// Why: chat persistence is centralized here so the /api/chat route (which
// writes turns) and the page loader (which reads history) stay in sync on
// title-derivation rules, message ordering, and scoping.

const MAX_TITLE_LENGTH = 60;

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
};

export type StoredConversation = {
  id: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: StoredMessage[];
};

/**
 * Return the user's most recent conversation with all its messages. Creates
 * an empty one on first call so the client always has something to render
 * against. Every subsequent visit rehydrates from here.
 */
export async function getOrCreateActiveConversation(
  userId: string,
): Promise<StoredConversation> {
  const latest = await prisma.conversation.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (latest) return toDto(latest);

  const created = await prisma.conversation.create({
    data: { userId },
    include: { messages: true },
  });
  return toDto(created);
}

export async function createConversation(
  userId: string,
): Promise<StoredConversation> {
  const created = await prisma.conversation.create({
    data: { userId },
    include: { messages: true },
  });
  return toDto(created);
}

export async function listConversations(
  userId: string,
): Promise<Array<Omit<StoredConversation, "messages">>> {
  const rows = await prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows;
}

/**
 * Fetch a specific conversation (with messages), scoped to userId. Returns
 * null if not found or not owned — callers should return 404.
 */
export async function getConversation(
  conversationId: string,
  userId: string,
): Promise<StoredConversation | null> {
  const row = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  return row ? toDto(row) : null;
}

export async function deleteConversation(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  // Why: deleteMany scoped by userId keeps cross-tenant deletes impossible in
  // a single query. Cascade removes messages via schema `onDelete: Cascade`.
  const result = await prisma.conversation.deleteMany({
    where: { id: conversationId, userId },
  });
  return result.count > 0;
}

/**
 * Persist one message and bump the conversation's `updatedAt`. If the
 * conversation still has no title and the incoming message is from the user,
 * derive a title from the first ~60 chars.
 */
export async function appendMessage(params: {
  conversationId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
}): Promise<void> {
  // Why: verify ownership before writing. A malicious client could try to
  // append into someone else's conversation by guessing an ID; the ownership
  // check here plus the userId-scoped queries in the rest of this module
  // close that.
  const conv = await prisma.conversation.findFirst({
    where: { id: params.conversationId, userId: params.userId },
    select: { id: true, title: true },
  });
  if (!conv) throw new Error("Conversation not found or not owned");

  const shouldTitle =
    conv.title === null && params.role === "user" && params.content.trim().length > 0;

  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId: params.conversationId,
        role: params.role,
        content: params.content,
      },
    }),
    prisma.conversation.update({
      where: { id: params.conversationId },
      data: {
        // Why: touch updatedAt so this conversation floats to the top of the
        // "recent" list, matching the ordering `getOrCreateActiveConversation`
        // relies on.
        updatedAt: new Date(),
        ...(shouldTitle ? { title: deriveTitle(params.content) } : {}),
      },
    }),
  ]);
}

function deriveTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= MAX_TITLE_LENGTH) return oneLine;
  return oneLine.slice(0, MAX_TITLE_LENGTH - 1).trimEnd() + "…";
}

// Why: Prisma returns roles as `string` because Message.role is a String
// column (not an enum) — the DTO narrows to the union we actually store,
// falling back to 'assistant' on anything unexpected so a corrupt row can't
// crash the UI.
function toDto(row: {
  id: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: Date;
  }>;
}): StoredConversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messages: row.messages.map((m) => ({
      id: m.id,
      role: normalizeRole(m.role),
      content: m.content,
      createdAt: m.createdAt,
    })),
  };
}

function normalizeRole(role: string): StoredMessage["role"] {
  if (role === "user" || role === "assistant" || role === "system") return role;
  return "assistant";
}
