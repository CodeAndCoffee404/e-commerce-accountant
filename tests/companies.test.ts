import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * One person, more than one company.
 *
 * The three things that had to change together: an address can be invited
 * twice, signing in turns every one of those invitations into a membership,
 * and moving between them is a decision the server checks rather than takes
 * from the browser.
 */

const session: { userId: string | null } = { userId: null };
const updated: { tenantId?: string }[] = [];

vi.mock("@/auth", () => ({
  auth: async () => (session.userId ? { user: { id: session.userId } } : null),
  unstable_update: async (data: { tenantId?: string }) => {
    updated.push(data);

    return null;
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { getDb, schema } = await import("@/lib/db");
const { acrossTenants } = await import("@/lib/db/tenant");
const { companiesFor, resolveAccess } = await import("@/lib/auth/allowlist");
const { switchCompany } = await import("@/lib/auth/companies");
const { inRequest } = await import("./helpers/request-scope");

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const stamp = `${process.pid}-${Date.now()}`;
const tenants: string[] = [];
const people: string[] = [];

async function company(name: string): Promise<string> {
  const [row] = await getDb()
    .insert(schema.tenants)
    .values({ name: `${name} ${stamp}`, slug: `${name}-${stamp}` })
    .returning({ id: schema.tenants.id });

  tenants.push(row.id);

  return row.id;
}

async function person(email: string): Promise<string> {
  const id = `${email}-${stamp}`;

  await getDb().insert(schema.users).values({ id, email }).onConflictDoNothing();
  people.push(id);

  return id;
}

describe.skipIf(!HAS_DB)("belonging to more than one company", () => {
  afterAll(
    inRequest(async () => {
      for (const id of tenants) {
        await getDb().delete(schema.tenants).where(eq(schema.tenants.id, id));
      }
      for (const id of people) {
        await getDb().delete(schema.users).where(eq(schema.users.id, id));
      }
    }),
  );

  it(
    "invites the same address to two companies, and neither refuses",
    inRequest(async () => {
      const [a, b] = [await company("alpha"), await company("beta")];
      const email = `both-${stamp}@example.invalid`;

      // What the old unique index made impossible. Each owner invites without
      // knowing about the other.
      await getDb().insert(schema.allowedEmails).values([
        { tenantId: a, email, role: "owner" },
        { tenantId: b, email, role: "accountant" },
      ]);

      const rows = await getDb()
        .select({ tenantId: schema.allowedEmails.tenantId })
        .from(schema.allowedEmails)
        .where(eq(schema.allowedEmails.email, email));

      expect(rows.map((row) => row.tenantId).sort()).toEqual([a, b].sort());
    }),
  );

  it(
    "turns every invitation into a membership on the first sign-in",
    inRequest(async () => {
      const [a, b] = [await company("gamma"), await company("delta")];
      const email = `arrives-${stamp}@example.invalid`;
      const userId = await person(email);

      await getDb().insert(schema.allowedEmails).values([
        { tenantId: a, email, role: "owner" },
        { tenantId: b, email, role: "viewer" },
      ]);

      const signedIn = await resolveAccess(userId, email);

      // Not only the first: an invitation that never became a membership is a
      // company the switcher offers and the person cannot enter.
      expect(signedIn?.tenantId).toBe(a);
      expect((await companiesFor(userId)).map((row) => row.id).sort()).toEqual([a, b].sort());
    }),
  );

  it(
    "does not make a super-admin of an ordinary invitation",
    inRequest(async () => {
      const a = await company("epsilon");
      const email = `ordinary-${stamp}@example.invalid`;
      const userId = await person(email);

      await getDb()
        .insert(schema.allowedEmails)
        .values({ tenantId: a, email, role: "owner" });

      expect((await resolveAccess(userId, email))?.isSuperAdmin).toBe(false);
    }),
  );
});

describe.skipIf(!HAS_DB)("moving between companies", () => {
  it("refuses a company the person is not in", async () => {
    const [a, stranger] = await acrossTenants(async () => [
      await company("zeta"),
      await company("eta"),
    ]);
    const email = `member-${stamp}@example.invalid`;
    const userId = await acrossTenants(() => person(email));

    await acrossTenants(() =>
      getDb().insert(schema.memberships).values({ tenantId: a, userId, role: "owner" }),
    );

    session.userId = userId;

    // The target comes from the browser, so it is checked here rather than
    // trusted — and refused by name, not ignored.
    const refused = await switchCompany(stranger);

    expect(refused).toEqual({ ok: false, message: "You are not a member of that company." });
    expect(updated).toHaveLength(0);

    const allowed = await switchCompany(a);

    expect(allowed).toEqual({ ok: true, tenantId: a });
    expect(updated).toEqual([{ tenantId: a }]);
  });

  it("refuses when nobody is signed in", async () => {
    session.userId = null;

    expect(await switchCompany(tenants[0])).toEqual({ ok: false, message: "Sign in first." });
  });
});
