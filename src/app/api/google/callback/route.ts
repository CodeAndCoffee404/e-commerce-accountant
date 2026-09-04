import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { loadAccessFor } from "@/lib/access/queries";
import { allows } from "@/lib/access/sections";
import { enterTenant } from "@/lib/db/tenant";
import { saveConnection } from "@/lib/google/connection";
import { accountEmail, exchangeCode } from "@/lib/google/oauth";

import { callbackUrl, STATE_COOKIE } from "../connect/route";

function back(request: Request, outcome: string): NextResponse {
  return NextResponse.redirect(new URL(`/settings?drive=${outcome}`, request.url));
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user?.id || !session.tenantId) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  // Named here rather than by requireUser: a route handler answers the
  // browser directly and never passes through it.
  enterTenant(session.tenantId);

  // The connection is a company setting, so it is the same permission that
  // started the flow — checked again on return, because the redirect back is
  // itself a request anyone can make.
  const access = await loadAccessFor(session.tenantId, session.role);

  if (!allows(access, "settings_company", "edit")) return back(request, "forbidden");

  const url = new URL(request.url);
  const store = await cookies();
  const expected = store.get(STATE_COOKIE)?.value;

  store.delete(STATE_COOKIE);

  if (url.searchParams.get("error")) return back(request, "cancelled");

  const state = url.searchParams.get("state");

  // Compared before anything is stored: a mismatch means the flow was started
  // somewhere other than here, and the Drive on the far end is not the
  // client's.
  if (!expected || !state || state !== expected) return back(request, "state");

  const code = url.searchParams.get("code");

  if (!code) return back(request, "nocode");

  try {
    const tokens = await exchangeCode(code, callbackUrl(request));

    if (!tokens.refreshToken) {
      // Without one the connection works until the access token expires and
      // then fails silently, which is worse than refusing now.
      return back(request, "norefresh");
    }

    await saveConnection({
      tenantId: session.tenantId,
      email: await accountEmail(tokens.accessToken),
      refreshToken: tokens.refreshToken,
      scope: tokens.scope,
      connectedBy: session.user.id,
    });

    return back(request, "connected");
  } catch {
    return back(request, "failed");
  }
}
