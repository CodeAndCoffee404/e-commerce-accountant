import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { loadAccessFor } from "@/lib/access/queries";
import { allows, type AccessLevel, type AccessMap, type SectionId } from "@/lib/access/sections";
import type { MembershipRole } from "@/lib/db/schema";
import { withTenant } from "@/lib/db/tenant";
import { DEFAULT_ROUTE, SELECT_COMPANY } from "@/lib/navigation";
import { landingRoute } from "@/lib/navigation";
import { membershipIn } from "./allowlist";

export type CurrentUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  tenantId: string;
  role: MembershipRole;
  /** Above the companies. Not a role: it says nothing about this company. */
  isSuperAdmin: boolean;
};

/**
 * Runs one page, Server Action or route handler as one unit of work, on a
 * transaction that has told Postgres which company it is for.
 *
 * It reads the session itself rather than taking the company as an argument,
 * because the company is not known until the session is read and the body
 * cannot enclose itself. Reading it twice — here and again in the body's own
 * `requireUser` — costs a JWT verification, not a query.
 *
 * Nobody signed in is left to the body: its own check redirects or refuses,
 * with the wording that belongs to it, and there is nothing to scope anyway.
 *
 * Hence the shape every page, action and route handler has: the exported
 * function is a door, one line long, and the work sits beside it in a function
 * of the same name ending `InScope`. Wrapping the body in place would have
 * re-indented every one of them and buried the work a level deeper; this way
 * the work reads exactly as it did, and what changed is visible in one line.
 * `tests/tenant-scope-coverage.test.ts` fails on a door that forgets to open.
 */
export function inRequest<T>(body: () => Promise<T>): Promise<T> {
  return auth().then((session) =>
    session?.tenantId ? withTenant(session.tenantId, body) : body(),
  );
}

/**
 * The real access check. `proxy.ts` only looks at whether a cookie exists, so
 * every page behind the dashboard has to come through here.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await signedIn();

  // Not signed in at all, or signed in and holding a company they are no
  // longer in — an access that was withdrawn while the token was still valid.
  // The second is why the role is read on every request rather than carried in
  // the token: a withdrawal that takes effect at the next sign-in is not a
  // withdrawal.
  if (!user) redirect("/signin");
  if (!user.role) redirect(SELECT_COMPANY);

  return { ...user, role: user.role };
}

/**
 * The signed-in person, or null — for route handlers, which answer the browser
 * with a status rather than a redirect.
 *
 * `role` is null when the session names a company this person is not in.
 */
export async function signedIn(): Promise<(Omit<CurrentUser, "role"> & {
  role: MembershipRole | null;
  isSuperAdmin: boolean;
}) | null> {
  const session = await auth();

  if (!session?.user?.id || !session.user.email || !session.tenantId) return null;

  return {
    id: session.user.id,
    name: session.user.name ?? null,
    email: session.user.email,
    image: session.user.image ?? null,
    tenantId: session.tenantId,
    isSuperAdmin: session.isSuperAdmin,
    role: await membershipIn(session.user.id, session.tenantId),
  };
}

/**
 * The signed-in person and what they may do, for a route handler. Null covers
 * both "not signed in" and "not in this company"; the caller answers 401.
 */
export async function apiUser(): Promise<UserWithAccess | null> {
  const user = await signedIn();

  if (!user?.role) return null;

  return { ...user, role: user.role, access: await loadAccessFor(user.tenantId, user.role) };
}

/**
 * Guards the admin area, which is above the companies rather than inside one.
 *
 * A separate check from `requireSection`: those ask what a role may do in the
 * company being worked in, and this asks something the companies cannot answer
 * about themselves. Anyone else is sent to their own dashboard rather than
 * shown a refusal — a screen they are not meant to know about should not
 * announce itself.
 */
export async function requireSuperAdmin(): Promise<CurrentUser & { isSuperAdmin: true }> {
  const user = await signedIn();

  if (!user) redirect("/signin");
  if (!user.isSuperAdmin) redirect(DEFAULT_ROUTE);

  return { ...user, role: user.role ?? "owner", isSuperAdmin: true };
}

export type UserWithAccess = CurrentUser & { access: AccessMap };

/**
 * Reads one permission off a user.
 *
 * A free function rather than a method on the user, deliberately: the user
 * object is handed to Client Components, and a closure hanging off it cannot
 * cross that boundary — it would throw at render, on every page at once.
 */
export function can(
  user: { access: AccessMap },
  section: SectionId,
  level: AccessLevel,
): boolean {
  return allows(user.access, section, level);
}

/**
 * The signed-in person plus what their role may do, as the owner set it.
 *
 * Everything that renders a screen or runs an action goes through here rather
 * than comparing role names: the roles are fixed, what they may do is not.
 */
export async function requireAccess(): Promise<UserWithAccess> {
  const user = await requireUser();

  return { ...user, access: await loadAccessFor(user.tenantId, user.role) };
}

/**
 * Guards a page. Someone who may not open a section is sent somewhere they
 * can, rather than shown an empty screen they cannot act on.
 */
export async function requireSection(
  sections: SectionId | SectionId[],
  level: AccessLevel = "view",
): Promise<UserWithAccess> {
  const user = await requireAccess();
  const wanted = Array.isArray(sections) ? sections : [sections];

  if (!wanted.some((section) => can(user, section, level))) redirect(landingRoute(user.access));

  return user;
}
