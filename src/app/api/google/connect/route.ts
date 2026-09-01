import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { loadAccessFor } from "@/lib/access/queries";
import { allows } from "@/lib/access/sections";
import { connectUrl } from "@/lib/google/oauth";

export const STATE_COOKIE = "ea-google-state";

/**
 * The address Google returns to. It has to match one registered in the console
 * character for character.
 *
 * Built from AUTH_URL rather than the request host: every preview deployment
 * answers on its own hostname, and Google was never told about those, so a
 * connection started from one would come back to an unregistered address and
 * fail. AUTH_URL is pinned per environment for the same reason sign-in needs it.
 */
export function callbackUrl(request: Request): string {
  const base = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;

  return new URL("/api/google/callback", base ?? request.url).toString();
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user?.id || !session.tenantId) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  const access = await loadAccessFor(session.tenantId, session.role);

  if (!allows(access, "settings_company", "edit")) {
    return NextResponse.redirect(new URL("/settings?drive=forbidden", request.url));
  }

  // A random state, echoed back by Google and compared on return. Without it
  // an attacker could hand the client a link that connects the attacker's
  // Drive to the client's tenant.
  const state = randomBytes(24).toString("base64url");
  const store = await cookies();

  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.url.startsWith("https://"),
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(connectUrl(callbackUrl(request), state));
}
