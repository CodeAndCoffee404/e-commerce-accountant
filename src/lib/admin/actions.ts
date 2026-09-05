"use server";

import { and, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { del } from "@vercel/blob";

import { unstable_update } from "@/auth";
import { record } from "@/lib/audit/record";
import { normaliseEmail } from "@/lib/auth/allowlist";
import { requireSuperAdmin } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { log } from "@/lib/log";
import { acrossTenants } from "@/lib/db/tenant";
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

/** A company is a uuid. Anything else is not a company that got away — it is a typo. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const newCompanySchema = z.object({
  // Not unique, and nothing is keyed to it: the company's own owner renames it
  // afterwards. What tells two companies apart is the id the row is given.
  name: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().email(),
});

export async function createCompany(input: unknown): Promise<AdminResult> {
  const admin = await requireSuperAdmin();
  const parsed = newCompanySchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const { name, adminEmail } = parsed.data;

  return acrossTenants(async () => {
    const db = getDb();

    // No check that two companies do not share a name: the name is a label its
    // owner may change, and two companies called the same thing are still two
    // companies, told apart by the id this insert returns.
    const [company] = await db
      .insert(schema.tenants)
      .values({ name })
      .returning({ id: schema.tenants.id });

    // Reference data comes with the company — an empty rate table lets the
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
        payload: { name, admin: normaliseEmail(adminEmail) },
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

  // Above the companies, like creating one: `withTenant` would open a scope on
  // the company itself, and a closed company's scope is read-only — which is
  // the point of closing it, and would leave the one person who is meant to be
  // able to look inside unable to get in.
  await acrossTenants(async () => {
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

/**
 * Closes a company, or opens it again.
 *
 * Closed is read-only: its people still sign in and read what is already
 * there, nothing writes, and the nightly job passes it by. The refusal is
 * Postgres's, not a check in forty places — see `closeToWrites` in
 * `src/lib/db/tenant.ts`.
 *
 * Recorded in the company's own log, so its owner can see when it happened and
 * who did it rather than discovering that saving no longer works.
 */
export async function setCompanyBlocked(tenantId: string, blocked: boolean): Promise<AdminResult> {
  const admin = await requireSuperAdmin();

  if (!UUID.test(tenantId)) return { ok: false, message: "No such company." };

  return acrossTenants(async () => {
    const db = getDb();

    const [company] = await db
      .update(schema.tenants)
      .set({ blockedAt: blocked ? new Date() : null })
      .where(eq(schema.tenants.id, tenantId))
      .returning({ id: schema.tenants.id, name: schema.tenants.name });

    if (!company) return { ok: false, message: "No such company." };

    await record(
      { id: admin.id, email: admin.email, tenantId: company.id },
      {
        action: blocked ? "company.blocked" : "company.unblocked",
        entity: "tenant",
        entityId: company.id,
      },
    );

    revalidatePath("/", "layout");

    return {
      ok: true,
      message: blocked
        ? `${company.name} is closed. It can be read, and nothing can be changed.`
        : `${company.name} is open again.`,
    };
  });
}

/**
 * Removes a company: its rows, its files, and the company itself.
 *
 * Two things guard it, and both are deliberate. It has to be closed first —
 * two decisions at two different moments, which is not something anybody does
 * by accident — and the name has to be typed, because a list of companies is a
 * place where the wrong row is one pixel away.
 *
 * The rows go by the foreign keys that already cascade from the company. The
 * files have to be named first: once the rows are gone, nothing knows which
 * bytes belonged to whom, so the keys are read while they still exist and the
 * storage is emptied afterwards. A file that fails to delete leaves bytes
 * nobody can reach rather than a half-deleted company, and says so in the log.
 */
export async function deleteCompany(tenantId: string, typedName: string): Promise<AdminResult> {
  const admin = await requireSuperAdmin();

  if (!UUID.test(tenantId)) return { ok: false, message: "No such company." };

  const keys = await acrossTenants(async () => {
    const db = getDb();

    const [company] = await db
      .select({
        id: schema.tenants.id,
        name: schema.tenants.name,
        blockedAt: schema.tenants.blockedAt,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .limit(1);

    if (!company) return { ok: false as const, message: "No such company." };

    if (!company.blockedAt) {
      return {
        ok: false as const,
        message: `${company.name} is still open. Close it first — deleting a company that is in use should take two decisions, not one.`,
      };
    }

    if (typedName.trim() !== company.name) {
      return { ok: false as const, message: "The name does not match. Nothing was deleted." };
    }

    const [uploads, artifacts] = await Promise.all([
      db
        .select({ key: schema.sourceFiles.blobKey })
        .from(schema.sourceFiles)
        .where(eq(schema.sourceFiles.tenantId, company.id)),
      db
        .select({ key: schema.reportArtifacts.blobKey })
        .from(schema.reportArtifacts)
        .where(and(eq(schema.reportArtifacts.tenantId, company.id), isNotNull(schema.reportArtifacts.blobKey))),
    ]);

    await db.delete(schema.tenants).where(eq(schema.tenants.id, company.id));

    // In the platform log rather than the company's own: that one went with it.
    log.info("company.deleted", {
      tenantId: company.id,
      name: company.name,
      by: admin.email,
      files: uploads.length + artifacts.length,
    });

    return {
      ok: true as const,
      name: company.name,
      keys: [...uploads, ...artifacts].map((row) => row.key).filter((key): key is string => !!key),
    };
  });

  if (!keys.ok) return keys;

  const failed: string[] = [];

  for (const key of keys.keys) {
    try {
      await del(key);
    } catch (error) {
      failed.push(key);
      log.error("company.delete_blob_failed", error, { blobKey: key });
    }
  }

  revalidatePath("/", "layout");

  return {
    ok: true,
    message: failed.length
      ? `${keys.name} is gone. ${failed.length} of its ${keys.keys.length} files could not be removed from storage and are listed in the log.`
      : `${keys.name} is gone, with its ${keys.keys.length} files.`,
  };
}
