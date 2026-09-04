import { and, asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { acrossTenants, withTenant } from "@/lib/db/tenant";
import type { MembershipRole } from "@/lib/db/schema";
import { seedReferenceData } from "@/lib/reference/seed";

/**
 * The MVP serves one client, so a sign-in that is bootstrapped rather than
 * invited lands in this tenant. Multi-tenant sign-up gets its own flow later.
 */
export const DEFAULT_TENANT = { name: "Geyser", slug: "geyser" } as const;

export type Access = {
  tenantId: string;
  role: MembershipRole;
};

/** A company this person may work in, for the chooser and the switcher. */
export type Company = { id: string; name: string; slug: string };

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

/**
 * Every active invitation for this address.
 *
 * A list rather than a row since one person can be invited to two companies.
 * Ordered so that a first sign-in lands somewhere predictable rather than
 * wherever the planner happened to read first.
 */
export async function findInvitations(email: string): Promise<Access[]> {
  return getDb()
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
    .orderBy(asc(schema.allowedEmails.createdAt));
}

/**
 * Whether this address may sign in at all. Runs in the `signIn` callback,
 * before Auth.js has created a user row, so it only reads.
 */
export async function maySignIn(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  if (isBootstrapEmail(email, process.env.AUTH_BOOTSTRAP_EMAILS)) return true;

  return (await findInvitations(email)).length > 0;
}

export type SignedIn = {
  /** Where this sign-in starts. Someone in two companies can move afterwards. */
  tenantId: string;
  isSuperAdmin: boolean;
};

/**
 * Called once the user row exists. Turns every invitation this address holds
 * into a membership, and says which company the session opens in.
 *
 * Every one of them, not just the first: an invitation the person never
 * "arrived" at would otherwise leave them a company they can see in the
 * switcher and cannot enter.
 */
export async function resolveAccess(userId: string, email: string): Promise<SignedIn | null> {
  const invitations = await findInvitations(email);
  const bootstrap = isBootstrapEmail(email, process.env.AUTH_BOOTSTRAP_EMAILS);

  if (invitations.length === 0 && !bootstrap) return null;

  if (bootstrap) {
    // The only way to make the first one: production has no other lever, and
    // whoever can set the environment variable already controls the deployment.
    await getDb()
      .update(schema.users)
      .set({ isSuperAdmin: true })
      .where(eq(schema.users.id, userId));
  }

  if (invitations.length > 0) {
    for (const invitation of invitations) await ensureMembership(userId, invitation);

    return { tenantId: invitations[0].tenantId, isSuperAdmin: bootstrap };
  }

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

  return { tenantId: access.tenantId, isSuperAdmin: true };
}

/**
 * The companies this person may work in.
 *
 * A question that spans companies by its nature — "which of them is this
 * person in" — so it says `acrossTenants` rather than pretending otherwise.
 * It is still narrow: filtered by the person, returning names and nothing else.
 */
export async function companiesFor(userId: string): Promise<Company[]> {
  return acrossTenants(() =>
    getDb()
      .select({
        id: schema.tenants.id,
        name: schema.tenants.name,
        slug: schema.tenants.slug,
      })
      .from(schema.memberships)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
      .where(eq(schema.memberships.userId, userId))
      .orderBy(asc(schema.tenants.name)),
  );
}

/**
 * What this person may do in one company, or null when they are not in it.
 *
 * Scoped to the company being asked about rather than reaching across all of
 * them: the row is that company's, and the database will only hand it over to
 * a query that says so. Asking about the company already in hand — which is
 * what every request does — reuses its transaction rather than opening one.
 */
export async function membershipIn(
  userId: string,
  tenantId: string,
): Promise<MembershipRole | null> {
  const [row] = await withTenant(tenantId, () =>
    getDb()
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.tenantId, tenantId)))
      .limit(1),
  );

  return row?.role ?? null;
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

  // Reference data comes with the tenant. An empty rate table would let the
  // first report run and quietly produce nothing.
  await seedReferenceData(created.id);

  return created.id;
}

async function ensureMembership(userId: string, access: Access): Promise<void> {
  await getDb()
    .insert(schema.memberships)
    .values({ tenantId: access.tenantId, userId, role: access.role })
    .onConflictDoNothing();
}
