import { prisma } from "@/lib/prisma";

// Shared by the eval scripts: both need "which user's documents do I search?"
// resolved the same way.

export type UserSelector = { userEmail?: string; userId?: string };

export async function resolveUserId(args: UserSelector): Promise<string | null> {
  if (args.userId) return args.userId;
  if (args.userEmail) {
    const u = await prisma.user.findUnique({
      where: { email: args.userEmail },
      select: { id: true },
    });
    if (!u) {
      console.error(`No user found with email ${args.userEmail}`);
      return null;
    }
    return u.id;
  }
  // Fallback: if there's exactly one user in the DB, use them. Convenient for
  // solo dev; refuses to guess when ambiguous.
  const all = await prisma.user.findMany({ select: { id: true, email: true } });
  if (all.length === 1) {
    console.log(`(Using the only user in the DB: ${all[0].email})`);
    return all[0].id;
  }
  if (all.length > 1) {
    console.error(
      `Multiple users found (${all.length}); pass --user-email or --user-id.`,
    );
    console.error("Known emails:", all.map((u) => u.email).join(", "));
  }
  return null;
}
