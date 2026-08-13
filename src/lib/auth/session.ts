import { redirect } from "next/navigation";

import { auth } from "@/auth";
import type { MembershipRole } from "@/lib/db/schema";

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
