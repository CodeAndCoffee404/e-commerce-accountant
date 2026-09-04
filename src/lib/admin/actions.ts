"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { unstable_update } from "@/auth";
import { record } from "@/lib/audit/record";
import { normaliseEmail } from "@/lib/auth/allowlist";
import { requireSuperAdmin } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { acrossTenants, withTenant } from "@/lib/db/tenant";
import { seedReferenceData } from "@/lib/reference/seed";

/**
 * What the person above the companies can do to them: make one, and step into
 * one.
 *
 * Both span companies, so both stand row-level security down — and both are
 * guarded by `requireSuperAdmin` first, which is the only thing between this
 * file and every company's data.
 */

export type AdminResult = { ok: true; message: string } | { ok: false; message: string };

const newCompanySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,60}$/, "Letters, digits and dashes."),
  adminEmail: z.string().trim().email(),
});

export async function createCompany(input: unknown): Promise<AdminResult> {
  const admin = await requireSuperAdmin();
  const parsed = newCompanySchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const { name, slug, adminEmail } = parsed.data;

  return acrossTenants(async () => {
    const db = getDb();

    const [taken] = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug))
      .limit(1);

    if (taken) return { ok: false, message: `The short name "${slug}" is already in use.` };

    const [company] = await db
      .insert(schema.tenants)
      .values({ name, slug })
      .returning({ id: schema.tenants.id });

    // Reference data comes with the company. An empty rate table lets the
    // first report run and quietly produce nothing.
    await seedReferenceData(company.id);

    await db.insert(schema.allowedEmails).values({
      tenantId: company.id,
      email: normaliseEmail(adminEmail),
      role: "owner",
    });

    await record(
      { id: admin.id, email: admin.email, tenantId: company.id },
      {
        action: "company.created",
        entity: "tenant",
        entityId: company.id,
        payload: { name, slug, admin: normaliseEmail(adminEmail) },
      },
    );

    revalidatePath("/admin");

    return { ok: true, message: `${name} is ready. ${adminEmail} can sign in as its owner.` };
  });
}

/**
 * Steps into a company.
 *
 * It puts itself on that company's access list as an owner, rather than making
 * every check in the application treat super-admins as a special case. The
 * point is that it is visible: the company's own owner finds that address in
 * their Team list and can suspend it, and the audit log says when it happened.
 * An invisible way into someone's books would be worse than no way in.
 *
 * The access list, not just a membership: the list is what every check reads,
 * and what an owner edits. A membership alone would be a row nobody looks at.
 */
export async function enterCompany(tenantId: unknown): Promise<AdminResult> {
  const admin = await requireSuperAdmin();

  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, message: "No company chosen." };
  }

  const company = await acrossTenants(async () => {
    const [row] = await getDb()
      .select({ id: schema.tenants.id, name: schema.tenants.name })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .limit(1);

    return row ?? null;
  });

  if (!company) return { ok: false, message: "No such company." };

  await withTenant(company.id, async () => {
    await getDb()
      .insert(schema.allowedEmails)
      .values({ tenantId: company.id, email: normaliseEmail(admin.email), role: "owner" })
      .onConflictDoUpdate({
        target: [schema.allowedEmails.tenantId, schema.allowedEmails.email],
        set: { role: "owner", isActive: true },
      });

    await getDb()
      .insert(schema.memberships)
      .values({ tenantId: company.id, userId: admin.id, role: "owner" })
      .onConflictDoNothing();

    await record(
      { id: admin.id, email: admin.email, tenantId: company.id },
      { action: "company.entered", entity: "tenant", entityId: company.id, payload: {} },
    );
  });

  await unstable_update({ tenantId: company.id });
  revalidatePath("/", "layout");

  return { ok: true, message: `Working in ${company.name}.` };
}
