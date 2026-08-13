import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth.js names the cookie differently over https, and the `__Secure-` prefix
 * is what production actually sends.
 */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

const PUBLIC_PATHS = ["/signin"];

/**
 * An optimistic check only: it reads whether a session cookie is present, not
 * whether it is valid. Proxy runs on every navigation including prefetches, so
 * verifying the token here would put a signature check on the hot path for no
 * security gain — the dashboard layout calls `auth()` and is what actually
 * enforces access.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));

  if (!hasSession && !isPublic) {
    const signIn = new URL("/signin", request.nextUrl);

    // Remember where the user was headed so sign-in can return them there.
    if (pathname !== "/") signIn.searchParams.set("next", pathname);

    return NextResponse.redirect(signIn);
  }

  return NextResponse.next();
}

export const config = {
  // `api` is excluded so the Auth.js callback routes stay reachable while
  // signed out; the rest skips static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
