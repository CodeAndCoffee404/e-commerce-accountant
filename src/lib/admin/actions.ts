"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { unstable_update } from "@/auth";
import { record } from "@/lib/audit/record";
import { normaliseEmail } from "@/lib/auth/allowlist";
import { requireSuperAdmin } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { acrossTenants, withTenant } from "@/lib/db/tenant";
import { seedReferenceData } from "@/lib/reference/seed";
import { companyProfile } from "@/modules/companies/registry";

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
  profileKey: z.string().trim().min(1),
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

  const { name, slug, adminEmail, profileKey } = parsed.data;

  // Before anything is written: a company whose profile does not exist cannot
  // have reports built, and would be seeded from somebody else's values.
  let profile;

  try {
    profile = companyProfile(profileKey);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Unknown profile." };
  }

  return acrossTenants(async () => {
    const db = getDb();

    const [taken] = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug))
      .limit(1);

    if (taken) return { ok: false, message: `The short name "${slug}" is already in use.` };

    // Checked above and again here by the database: two admins submitting the
    // same short name at once would otherwise get an error blaming the network.
    const [company] = await db
      .insert(schema.tenants)
      .values({ name, slug, profileKey })
      .onConflictDoNothing({ target: schema.tenants.slug })
      .returning({ id: schema.tenants.id });

    if (!company) return { ok: false, message: `The short name "${slug}" is already in use.` };

    // Reference data comes with the company, and from its own profile — an
    // empty rate table lets the first report run and quietly produce nothing,
    // and somebody else's rates are worse than an empty one.
    await seedReferenceData(company.id, profile);

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
        payload: { name, slug, profileKey, admin: normaliseEmail(adminEmail) },
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

  // `tenants` carries no company of its own and no row-level security, so this
  // scope buys nothing but saying out loud that the question is about all of
  // them.
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
    // Read before writing, so the record says what was overwritten. Forcing
    // ownership is defensible; doing it to a row the company's owner had
    // deliberately scoped — a viewer, or a suspension — without saying so is
    // not, and the Activity screen is where they would look.
    const [before] = await getDb()
      .select({ role: schema.allowedEmails.role, isActive: schema.allowedEmails.isActive })
      .from(schema.allowedEmails)
      .where(
        and(
          eq(schema.allowedEmails.tenantId, company.id),
          eq(schema.allowedEmails.email, normaliseEmail(admin.email)),
        ),
      )
      .limit(1);

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
      {
        action: "company.entered",
        entity: "tenant",
        entityId: company.id,
        payload:
          !before
            ? { granted: "owner" }
            : before.role === "owner" && before.isActive
              ? {}
              : { replaced: { role: before.role, isActive: before.isActive } },
      },
    );
  });

  await unstable_update({ tenantId: company.id });
  revalidatePath("/", "layout");

  return { ok: true, message: `Working in ${company.name}.` };
}
