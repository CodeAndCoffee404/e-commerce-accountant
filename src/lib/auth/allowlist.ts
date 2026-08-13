import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { MembershipRole } from "@/lib/db/schema";

/**
 * The MVP serves one client, so a sign-in that is bootstrapped rather than
 * invited lands in this tenant. Multi-tenant sign-up gets its own flow later.
 */
export const DEFAULT_TENANT = { name: "Geyser", slug: "geyser" } as const;

export type Access = {
  tenantId: string;
  role: MembershipRole;
};

/**
 * Emails from `AUTH_BOOTSTRAP_EMAILS` may sign in even though nobody has
 * invited them yet, and become owners of the default tenant.
 *
 * It exists because production has no other way in: the Neon credentials are
 * Sensitive and unreadable, so no one can seed the first row by hand. Setting
 * an environment variable is the only lever available, and whoever can set it
 * already controls the deployment.
 */
export function parseBootstrapEmails(raw: string | undefined): string[] {
  if (!raw) return [];

  return raw
    .split(",")
    .map((email) => normaliseEmail(email))
    .filter((email) => email.includes("@"));
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Decides whether an authenticated Google account may enter, without touching
 * the database. Split out from {@link resolveAccess} so the decision itself is
 * testable.
 */
export function isBootstrapEmail(email: string, raw: string | undefined): boolean {
  return parseBootstrapEmails(raw).includes(normaliseEmail(email));
}

/** Invited address, active row only. Returns null when there is no invitation. */
export async function findInvitation(email: string): Promise<Access | null> {
  const [row] = await getDb()
    .select({
      tenantId: schema.allowedEmails.tenantId,
      role: schema.allowedEmails.role,
    })
    .from(schema.allowedEmails)
    .where(
      and(
        eq(schema.allowedEmails.email, normaliseEmail(email)),
        eq(schema.allowedEmails.isActive, true),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Whether this address may sign in at all. Runs in the `signIn` callback,
 * before Auth.js has created a user row, so it only reads.
 */
export async function maySignIn(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  if (isBootstrapEmail(email, process.env.AUTH_BOOTSTRAP_EMAILS)) return true;

  return (await findInvitation(email)) !== null;
}

/**
 * Called once the user row exists. Returns the tenant the user belongs to,
 * creating the invitation and membership on a bootstrap sign-in.
 */
export async function resolveAccess(userId: string, email: string): Promise<Access | null> {
  const invitation = await findInvitation(email);

  if (invitation) {
    await ensureMembership(userId, invitation);
    return invitation;
  }

  if (!isBootstrapEmail(email, process.env.AUTH_BOOTSTRAP_EMAILS)) return null;

  const access: Access = { tenantId: await ensureDefaultTenant(), role: "owner" };

  await getDb()
    .insert(schema.allowedEmails)
    .values({
      tenantId: access.tenantId,
      email: normaliseEmail(email),
      role: access.role,
    })
    .onConflictDoNothing();

  await ensureMembership(userId, access);

  return access;
}

async function ensureDefaultTenant(): Promise<string> {
  const [existing] = await getDb()
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, DEFAULT_TENANT.slug))
    .limit(1);

  if (existing) return existing.id;

  const [created] = await getDb()
    .insert(schema.tenants)
    .values({ name: DEFAULT_TENANT.name, slug: DEFAULT_TENANT.slug })
    .returning({ id: schema.tenants.id });

  return created.id;
}

async function ensureMembership(userId: string, access: Access): Promise<void> {
  await getDb()
    .insert(schema.memberships)
    .values({ tenantId: access.tenantId, userId, role: access.role })
    .onConflictDoNothing();
}
