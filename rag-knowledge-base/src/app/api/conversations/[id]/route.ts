import { NextResponse } from "next/server";
import { requireUser, unauthenticated, tooMany, ID_RE } from "@/lib/api/guards";
import {
  BUCKETS,
  READ_LIMITS,
  checkRateLimit,
} from "@/lib/security/rateLimit";
import { deleteConversation, getConversation } from "@/lib/chat/persistence";

export const runtime = "nodejs";

// Next 16 route context: params is a Promise that must be awaited.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
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

    const { id } = await ctx.params;
    if (!ID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const conv = await getConversation(id, user.id);
    if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
      messages: conv.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[conversation:GET] failed", err);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
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

    const { id } = await ctx.params;
    if (!ID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const ok = await deleteConversation(id, user.id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[conversation:DELETE] failed", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
