import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateUser } from "@/lib/auth/getOrCreateUser";

export const runtime = "nodejs";

export async function GET() {
  const user = await getOrCreateUser();
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
  const user = await getOrCreateUser();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
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
