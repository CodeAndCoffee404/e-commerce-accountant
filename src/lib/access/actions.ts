"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";

import {
  ACCESS_LEVELS,
  levelsFor,
  sectionDefinition,
  SECTION_IDS,
  type AccessLevel,
} from "./sections";

export type AccessResult = { ok: boolean; message: string };

const inputSchema = z.object({
  role: z.enum(["accountant", "viewer"]),
  section: z.enum(SECTION_IDS as [string, ...string[]]),
  access: z.enum(ACCESS_LEVELS),
});

export type SaveRoleAccessInput = z.input<typeof inputSchema>;

/**
 * Sets what one role may do with one section.
 *
 * Owner-only by design, and the owner's own row is not settable at all: the
 * one mistake that cannot be undone from inside the application is an account
 * whose owner can no longer reach the screen that hands access out.
 */
export async function saveRoleAccess(raw: SaveRoleAccessInput): Promise<AccessResult> {
  const user = await requireUser();

  if (user.role !== "owner") {
    return { ok: false, message: "Only the owner can change access." };
  }

  const parsed = inputSchema.safeParse(raw);

  if (!parsed.success) return { ok: false, message: "That is not a setting this screen has." };

  const section = sectionDefinition(parsed.data.section as (typeof SECTION_IDS)[number]);

  if (section.ownerOnly) {
    return { ok: false, message: `${section.label} stays with the owner.` };
  }

  if (!levelsFor(section).includes(parsed.data.access as AccessLevel)) {
    return { ok: false, message: `${section.label} has nothing to edit.` };
  }

  const db = getDb();

  await db
    .insert(schema.rolePermissions)
    .values({
      tenantId: user.tenantId,
      role: parsed.data.role,
      section: section.id,
      access: parsed.data.access,
      updatedBy: user.id,
    })
    .onConflictDoUpdate({
      target: [
        schema.rolePermissions.tenantId,
        schema.rolePermissions.role,
        schema.rolePermissions.section,
      ],
      set: { access: parsed.data.access, updatedAt: new Date(), updatedBy: user.id },
    });

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    {
      action: "access.updated",
      entity: "role_permission",
      entityId: `${parsed.data.role}:${section.id}`,
      payload: { role: parsed.data.role, section: section.id, access: parsed.data.access },
    },
  );

  // Access decides what every screen renders, not just this one.
  revalidatePath("/", "layout");

  return { ok: true, message: `${section.label} updated for ${parsed.data.role}.` };
}

/** Puts one role back on the built-in defaults, for every section. */
export async function resetRoleAccess(role: unknown): Promise<AccessResult> {
  const user = await requireUser();

  if (user.role !== "owner") {
    return { ok: false, message: "Only the owner can change access." };
  }

  const parsed = z.enum(["accountant", "viewer"]).safeParse(role);

  if (!parsed.success) return { ok: false, message: "No such role." };

  await getDb()
    .delete(schema.rolePermissions)
    .where(
      and(
        eq(schema.rolePermissions.tenantId, user.tenantId),
        eq(schema.rolePermissions.role, parsed.data),
      ),
    );

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    { action: "access.reset", entity: "role_permission", payload: { role: parsed.data } },
  );

  revalidatePath("/", "layout");

  return { ok: true, message: `${parsed.data} is back on the defaults.` };
}
