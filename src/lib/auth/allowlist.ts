import { and, asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { acrossTenants, withTenant } from "@/lib/db/tenant";
import type { MembershipRole } from "@/lib/db/schema";
import { seedReferenceData } from "@/lib/reference/seed";
import { GEYSER } from "@/modules/companies/geyser";

/**
 * The MVP serves one client, so a sign-in that is bootstrapped rather than
 * invited lands in this tenant. Multi-tenant sign-up gets its own flow later.
 */
export const DEFAULT_TENANT = { name: "Geyser" } as const;

export type Access = {
  tenantId: string;
  role: MembershipRole;
};

/** A company this person may work in, for the chooser and the switcher. */
export type Company = { id: string; name: string };

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
};

/**
 * Called once the user row exists. Records that this address has arrived in
 * every company that invited it, and says which one the session opens in.
 *
 * Every one of them, not just the first: a membership is what the Team screen
 * reads to show who has actually signed in, and an address missing from it
 * looks invited but absent forever. It is only a record — what a person may do
 * is read from the invitation, on every request.
 */
export async function resolveAccess(userId: string, email: string): Promise<SignedIn | null> {
  const invitations = await findInvitations(email);
  const bootstrap = isBootstrapEmail(email, process.env.AUTH_BOOTSTRAP_EMAILS);

  if (invitations.length === 0 && !bootstrap) return null;

  if (bootstrap) {
    // The only way to make the first one: production has no other lever, and
    // whoever can set the environment variable already controls the deployment.
    // Written to the row rather than to the token, so that taking it away is
    // an edit somebody can make rather than a wait for a session to expire.
    await getDb()
      .update(schema.users)
      .set({ isSuperAdmin: true })
      .where(eq(schema.users.id, userId));
  }

  if (invitations.length > 0) {
    for (const invitation of invitations) await ensureMembership(userId, invitation);

    return { tenantId: invitations[0].tenantId };
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

  return { tenantId: access.tenantId };
}

/**
 * The companies this person may work in.
 *
 * Read from the invitations rather than from the memberships, and that is the
 * whole point: an invitation is what an owner edits — the list that says who
 * may come in and as what — while a membership only records that somebody once
 * did. Suspending an address has to take a company off this list, and it can
 * only do so if the list is built from the thing suspension writes to.
 *
 * A question that spans companies by its nature, so it says `acrossTenants`
 * rather than pretending otherwise. It is still narrow: filtered by the
 * address, returning names and nothing else.
 */
export async function companiesFor(email: string): Promise<Company[]> {
  return acrossTenants(() =>
    getDb()
      .select({
        id: schema.tenants.id,
        name: schema.tenants.name,
      })
      .from(schema.allowedEmails)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.allowedEmails.tenantId))
      .where(
        and(
          eq(schema.allowedEmails.email, normaliseEmail(email)),
          eq(schema.allowedEmails.isActive, true),
        ),
      )
      .orderBy(asc(schema.tenants.name)),
  );
}

/**
 * What this address may do in one company, or null when it may not come in.
 *
 * The invitation is the authority, not the membership. An owner demoting an
 * accountant or suspending them writes to the invitation; a membership is
 * written once, at a first sign-in, and never again. Reading the membership
 * here would freeze everyone's role at whatever it was the day they arrived —
 * which is how a demotion becomes a change that shows on the screen and
 * changes nothing.
 *
 * Scoped to the company being asked about rather than reaching across all of
 * them: the row is that company's, and the database will only hand it over to
 * a query that says so. Asking about the company already in hand — which is
 * what every request does — reuses its transaction rather than opening one.
 */
export async function roleFor(email: string, tenantId: string): Promise<MembershipRole | null> {
  const [row] = await withTenant(tenantId, () =>
    getDb()
      .select({ role: schema.allowedEmails.role })
      .from(schema.allowedEmails)
      .where(
        and(
          eq(schema.allowedEmails.tenantId, tenantId),
          eq(schema.allowedEmails.email, normaliseEmail(email)),
          eq(schema.allowedEmails.isActive, true),
        ),
      )
      .limit(1),
  );

  return row?.role ?? null;
}

/**
 * Found by its profile, not by its name: the name is the company's own to
 * change, and a bootstrap sign-in that could not find the company because
 * somebody renamed it would make a second one beside it.
 */
async function ensureDefaultTenant(): Promise<string> {
  const [existing] = await getDb()
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.profileKey, GEYSER.key))
    .limit(1);

  if (existing) return existing.id;

  const [created] = await getDb()
    .insert(schema.tenants)
    .values({
      name: DEFAULT_TENANT.name,
      profileKey: GEYSER.key,
    })
    .returning({ id: schema.tenants.id });

  // Reference data comes with the tenant. An empty rate table would let the
  // first report run and quietly produce nothing.
  await seedReferenceData(created.id, GEYSER);

  return created.id;
}

async function ensureMembership(userId: string, access: Access): Promise<void> {
  await getDb()
    .insert(schema.memberships)
    .values({ tenantId: access.tenantId, userId, role: access.role })
    .onConflictDoNothing();
}

/**
 * Whether this person stands above the companies.
 *
 * Read on every request rather than carried in the token, for the same reason
 * the role is: a power that can only be taken away by waiting for somebody to
 * sign out is not one that can be taken away. `users` carries no company and
 * no row-level security, so this needs no scope of its own.
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ isSuperAdmin: schema.users.isSuperAdmin })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  return row?.isSuperAdmin ?? false;
}
