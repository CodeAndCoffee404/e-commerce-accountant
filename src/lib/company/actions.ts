"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { can, inRequest, requireAccess } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";

/**
 * What a company is called.
 *
 * Its own owner decides, and can change their mind: a company is renamed,
 * bought, or was typed in wrong on the day it was created. Which is exactly
 * why nothing is keyed to the name — the rows a company owns, the folder its
 * files live under, who may come in, all point at the id the row was given and
 * are untouched by this.
 */

export type CompanyResult = { ok: true; message: string } | { ok: false; message: string };

const renameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "A company name is at least 2 characters")
    .max(120, "A company name is at most 120 characters"),
});

export async function renameCompany(input: unknown): Promise<CompanyResult> {
  return inRequest(() => renameCompanyInScope(input));
}

async function renameCompanyInScope(input: unknown): Promise<CompanyResult> {
  // The same lever as inviting somebody: an accountant closes the month, an
  // owner decides what the company is and who is in it.
  const user = await requireAccess();

  if (!can(user, "team", "edit")) {
    return { ok: false, message: "Only an owner can rename the company." };
  }

  const parsed = renameSchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const { name } = parsed.data;
  const db = getDb();

  const [before] = await db
    .select({ name: schema.tenants.name })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, user.tenantId))
    .limit(1);

  if (!before) return { ok: false, message: "This company no longer exists." };

  if (before.name === name) return { ok: true, message: "The name is already that." };

  await db.update(schema.tenants).set({ name }).where(eq(schema.tenants.id, user.tenantId));

  // Both names, because the point of the entry is telling somebody what the
  // company used to be called when they come back to a name they do not know.
  await record(user, {
    action: "company.renamed",
    entity: "tenant",
    entityId: user.tenantId,
    payload: { from: before.name, to: name },
  });

  // Everywhere, not only this page: the name is in the app bar on all of them.
  revalidatePath("/", "layout");

  return { ok: true, message: `This company is now called ${name}.` };
}
