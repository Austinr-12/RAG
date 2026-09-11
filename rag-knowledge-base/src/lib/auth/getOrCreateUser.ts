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
  // Why: prefer an address Clerk has verified — the email is also our
  // relink key below, and relinking must only happen on proven ownership.
  const addresses = clerkUser?.emailAddresses ?? [];
  const verified = addresses.find((a) => a.verification?.status === "verified");
  const email =
    verified?.emailAddress ??
    addresses[0]?.emailAddress ??
    `${clerkId}@unknown.local`;

  try {
    // Why: upsert (not create) handles the race where two parallel first requests both miss findUnique.
    return await prisma.user.upsert({
      where: { clerkId },
      create: { clerkId, email },
      update: {},
      select: { id: true, clerkId: true },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // The upsert keys on clerkId, but email is unique too. Landing here means
    // the address already belongs to a row with a DIFFERENT clerkId — the
    // Clerk account was deleted and re-created. If Clerk verified the address,
    // the session legitimately owns it: relink the existing row (keeping its
    // documents and conversations) to the new clerkId. Unverified addresses
    // never relink — that would let anyone claim a row by typing its email.
    if (verified) {
      return prisma.user.update({
        where: { email: verified.emailAddress },
        data: { clerkId },
        select: { id: true, clerkId: true },
      });
    }
    return prisma.user.upsert({
      where: { clerkId },
      create: { clerkId, email: `${clerkId}@unknown.local` },
      update: {},
      select: { id: true, clerkId: true },
    });
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}
