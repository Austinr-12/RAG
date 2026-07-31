import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getOrCreateUser,
  UnauthenticatedError,
} from "@/lib/auth/getOrCreateUser";
import {
  BUCKETS,
  READ_LIMITS,
  checkRateLimit,
} from "@/lib/security/rateLimit";

export const runtime = "nodejs";

async function requireUser() {
  try {
    return await getOrCreateUser();
  } catch (err) {
    if (err instanceof UnauthenticatedError) return null;
    throw err;
  }
}

// Why: fresh response per call — NextResponse bodies are streams and can't be
// safely shared across concurrent requests.
const unauthenticated = () =>
  NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthenticated();
  const gate = checkRateLimit(
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
}

export async function DELETE(request: Request) {
  const user = await requireUser();
  if (!user) return unauthenticated();
  const gate = checkRateLimit(
    BUCKETS.readMinute,
    user.id,
    READ_LIMITS.perMinute,
    60_000,
  );
  if (!gate.ok) return tooMany(gate.retryAfterSec);

  const id = new URL(request.url).searchParams.get("id");
  // Why: cuid ids are ~25 chars of [a-z0-9]. Reject obvious garbage before hitting
  // the DB so scanners spamming random ids don't generate query load.
  if (!id || !/^[a-z0-9]{10,64}$/.test(id)) {
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
}

function tooMany(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests", retryAfterSec },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
