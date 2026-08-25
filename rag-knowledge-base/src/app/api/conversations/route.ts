import { NextResponse } from "next/server";
import {
  getOrCreateUser,
  UnauthenticatedError,
} from "@/lib/auth/getOrCreateUser";
import {
  createConversation,
  listConversations,
} from "@/lib/chat/persistence";

export const runtime = "nodejs";

async function requireUser() {
  try {
    return await getOrCreateUser();
  } catch (err) {
    if (err instanceof UnauthenticatedError) return null;
    throw err;
  }
}

const unauthenticated = () =>
  NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

export async function GET() {
  try {
    const user = await requireUser();
    if (!user) return unauthenticated();
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
