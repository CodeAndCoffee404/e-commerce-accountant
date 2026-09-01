import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { loadAccessFor } from "@/lib/access/queries";
import { allows, type AccessLevel, type AccessMap, type SectionId } from "@/lib/access/sections";
import type { MembershipRole } from "@/lib/db/schema";
import { landingRoute } from "@/lib/navigation";

export type CurrentUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  tenantId: string;
  role: MembershipRole;
};

/**
 * The real access check. `proxy.ts` only looks at whether a cookie exists, so
 * every page behind the dashboard has to come through here.
 */
export async function requireUser(): Promise<CurrentUser> {
  const session = await auth();

  if (!session?.user?.id || !session.user.email || !session.tenantId) {
    redirect("/signin");
  }

  return {
    id: session.user.id,
    name: session.user.name ?? null,
    email: session.user.email,
    image: session.user.image ?? null,
    tenantId: session.tenantId,
    role: session.role,
  };
}

export type UserWithAccess = CurrentUser & {
  access: AccessMap;
  /** Sugar for the pages: `can("reports", "edit")`. */
  can: (section: SectionId, level: AccessLevel) => boolean;
};

/**
 * The signed-in person plus what their role may do, as the owner set it.
 *
 * Everything that renders a screen or runs an action goes through here rather
 * than comparing role names: the roles are fixed, what they may do is not.
 */
export async function requireAccess(): Promise<UserWithAccess> {
  const user = await requireUser();
  const access = await loadAccessFor(user.tenantId, user.role);

  return {
    ...user,
    access,
    can: (section, level) => allows(access, section, level),
  };
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

  if (!wanted.some((section) => user.can(section, level))) redirect(landingRoute(user.access));

  return user;
}
