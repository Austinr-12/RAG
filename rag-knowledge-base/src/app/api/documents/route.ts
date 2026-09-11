import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, unauthenticated, tooMany, ID_RE } from "@/lib/api/guards";
import {
  BUCKETS,
  READ_LIMITS,
  checkRateLimit,
} from "@/lib/security/rateLimit";

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

    // Why: _count.chunks avoids loading chunk rows just to count them.
    const docs = await prisma.document.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { chunks: true } },
      },
    });
    return NextResponse.json({
      documents: docs.map((d) => ({
        id: d.id,
        name: d.name,
        createdAt: d.createdAt.toISOString(),
        chunkCount: d._count.chunks,
      })),
    });
  } catch (err) {
    console.error("[documents:GET] failed", err);
    return NextResponse.json({ error: "Failed to load documents" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
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

    const id = new URL(request.url).searchParams.get("id");
    if (!id || !ID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    // Why: deleteMany scoped to userId prevents cross-user deletion in one query.
    // Chunks are removed by schema's onDelete: Cascade.
    const result = await prisma.document.deleteMany({
      where: { id, userId: user.id },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[documents:DELETE] failed", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
