import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { connectUrl } from "@/lib/google/oauth";

export const STATE_COOKIE = "ea-google-state";

/** The address Google returns to; it has to match the console exactly. */
export function callbackUrl(request: Request): string {
  return new URL("/api/google/callback", request.url).toString();
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user?.id || !session.tenantId) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  if (session.role === "viewer") {
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
