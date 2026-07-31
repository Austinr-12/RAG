import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// Why: distinct class so route handlers can map to HTTP 401. Middleware normally
// gates these routes so this only fires in edge cases (session expired between
// middleware and handler), but the 500 the plain Error produced was misleading.
export class UnauthenticatedError extends Error {
  constructor() {
    super("Unauthenticated");
    this.name = "UnauthenticatedError";
  }
}

export async function getOrCreateUser(): Promise<{ id: string; clerkId: string }> {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new UnauthenticatedError();

  const existing = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true, clerkId: true },
  });
  if (existing) return existing;

  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses[0]?.emailAddress ?? `${clerkId}@unknown.local`;

  // Why: upsert (not create) handles the race where two parallel first requests both miss findUnique.
  return prisma.user.upsert({
    where: { clerkId },
    create: { clerkId, email },
    update: {},
    select: { id: true, clerkId: true },
  });
}
