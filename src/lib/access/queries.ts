import { eq } from "drizzle-orm";
import { cache } from "react";

import { getDb, schema } from "@/lib/db";
import type { MembershipRole } from "@/lib/db/schema";

import {
  isAccessLevel,
  isSectionId,
  resolveAccess,
  type AccessLevel,
  type AccessMap,
  type SectionId,
} from "./sections";

export type RoleAccessMatrix = Record<MembershipRole, AccessMap>;

const ROLES: MembershipRole[] = ["owner", "accountant", "viewer"];

/**
 * Cached for the request: the layout and the page it wraps both ask what this
 * person may see, and that is one question, not two.
 */
const loadOverrides = cache(async function loadOverrides(
  tenantId: string,
): Promise<Map<MembershipRole, Partial<Record<SectionId, AccessLevel>>>> {
  const rows = await getDb()
    .select({
      role: schema.rolePermissions.role,
      section: schema.rolePermissions.section,
      access: schema.rolePermissions.access,
    })
    .from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.tenantId, tenantId));

  const byRole = new Map<MembershipRole, Partial<Record<SectionId, AccessLevel>>>();

  for (const row of rows) {
    // A section retired from the app leaves its rows behind; they are ignored
    // rather than crashing the screen that reads them.
    if (!isSectionId(row.section) || !isAccessLevel(row.access)) continue;

    const current = byRole.get(row.role) ?? {};

    current[row.section] = row.access;
    byRole.set(row.role, current);
  }

  return byRole;
});

/** Every role's access, defaults filled in, for the access screen. */
export async function loadRoleAccess(tenantId: string): Promise<RoleAccessMatrix> {
  const overrides = await loadOverrides(tenantId);

  return Object.fromEntries(
    ROLES.map((role) => [role, resolveAccess(role, overrides.get(role) ?? {})]),
  ) as RoleAccessMatrix;
}

/** One role's access. What every page and every action asks for. */
export async function loadAccessFor(
  tenantId: string,
  role: MembershipRole,
): Promise<AccessMap> {
  // The owner's access is fixed, so their pages never wait on a query that
  // cannot change the answer.
  if (role === "owner") return resolveAccess("owner", {});

  const overrides = await loadOverrides(tenantId);

  return resolveAccess(role, overrides.get(role) ?? {});
}
