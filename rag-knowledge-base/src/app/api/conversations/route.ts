import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, unauthenticated, tooMany } from "@/lib/api/guards";
import {
  BUCKETS,
  CONVERSATION_LIMITS,
  READ_LIMITS,
  checkRateLimit,
} from "@/lib/security/rateLimit";
import {
  createConversation,
  listConversations,
} from "@/lib/chat/persistence";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    if (!user) return unauthenticated();
    const gate = await checkRateLimit(
      BUCKETS.readMinute,
      user.id,
      READ_LIMITS.perMinute,
      60_000,
    );
    if (!gate.ok) return tooMany(gate.retryAfterSec);

    const rows = await listConversations(user.id);
    return NextResponse.json({
      conversations: rows.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[conversations:GET] failed", err);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const user = await requireUser();
    if (!user) return unauthenticated();
    const gate = await checkRateLimit(
      BUCKETS.conversationCreateMinute,
      user.id,
      CONVERSATION_LIMITS.createPerMinute,
      60_000,
    );
    if (!gate.ok) return tooMany(gate.retryAfterSec);

    // Why: the one write path that had no quota — without it a hostile authed
    // user could create unbounded rows. Soft cap (count-then-create), same
    // model as the documents quota; the rate limit bounds the race window.
    const count = await prisma.conversation.count({
      where: { userId: user.id },
    });
    if (count >= CONVERSATION_LIMITS.maxPerUser) {
      return NextResponse.json(
        {
          error: `Conversation limit reached (${CONVERSATION_LIMITS.maxPerUser}). Delete old conversations to start new ones.`,
        },
        { status: 409 },
      );
    }

    const conv = await createConversation(user.id);
    return NextResponse.json(
      {
        id: conv.id,
        title: conv.title,
        createdAt: conv.createdAt.toISOString(),
        updatedAt: conv.updatedAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[conversations:POST] failed", err);
    return NextResponse.json({ error: "Failed to create" }, { status: 500 });
  }
}
