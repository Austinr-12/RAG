import { NextResponse } from "next/server";
import {
  getOrCreateUser,
  UnauthenticatedError,
} from "@/lib/auth/getOrCreateUser";

// Why: these helpers were copy-pasted across every API route; centralizing
// them keeps auth mapping, 429 shape, and id validation identical everywhere.

// Why: cuid ids are ~25 chars of [a-z0-9]. Reject obvious garbage before
// hitting the DB so scanners spamming random ids don't generate query load.
export const ID_RE = /^[a-z0-9]{10,64}$/;

export type AuthedUser = { id: string; clerkId: string };

/**
 * Resolve the authenticated user, or null when the request carries no valid
 * session. Any other failure (DB down, Clerk outage) still throws so route
 * handlers fall through to their generic 500.
 */
export async function requireUser(): Promise<AuthedUser | null> {
  try {
    return await getOrCreateUser();
  } catch (err) {
    if (err instanceof UnauthenticatedError) return null;
    throw err;
  }
}

// Why: fresh response per call — NextResponse bodies are streams and can't be
// safely shared across concurrent requests.
export function unauthenticated(): NextResponse {
  return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
}

export function tooMany(
  retryAfterSec: number,
  message = "Too many requests",
): NextResponse {
  return NextResponse.json(
    { error: message, retryAfterSec },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
