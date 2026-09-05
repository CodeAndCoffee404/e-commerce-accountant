import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * The screen above the companies.
 *
 * Two powers, and both of them reach across every company: making one, and
 * stepping into one. What is worth testing is the guard in front of them and
 * the fact that stepping in leaves a mark — an invisible way into someone's
 * books would be worse than no way in.
 */

const session: { userId: string | null; tenantId: string } = {
  userId: null,
  tenantId: "00000000-0000-0000-0000-000000000000",
};

const redirects: string[] = [];

vi.mock("@/auth", () => ({
  auth: async () =>
    session.userId
      ? {
          user: { id: session.userId, email: `${session.userId}@example.invalid`, name: null },
          tenantId: session.tenantId,
        }
      : null,
  unstable_update: async () => null,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirects.push(to);
    throw new Error(`redirected to ${to}`);
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { getDb, schema } = await import("@/lib/db");
const { acrossTenants } = await import("@/lib/db/tenant");
const { createCompany, enterCompany } = await import("@/lib/admin/actions");
const { allCompanies } = await import("@/lib/admin/queries");
const { inRequest } = await import("./helpers/request-scope");

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const stamp = `${process.pid}-${Date.now()}`;
/** The companies this file made, by the only thing that identifies one. */
const made: { id: string; name: string }[] = [];
const people: string[] = [];

/** The id of the company just created, found by the name this file gave it. */
async function idOf(name: string): Promise<string> {
  const [row] = await acrossTenants(() =>
    getDb().select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.name, name)),
  );

  made.push({ id: row.id, name });

  return row.id;
}

/**
 * Standing above the companies is a row, not a claim in the session — which is
 * what makes it revocable — so these tests set the row.
 */
async function admin(above = true): Promise<string> {
  const id = `admin-${stamp}`;

  await acrossTenants(async () => {
    await getDb()
      .insert(schema.users)
      .values({ id, email: `${id}@example.invalid`, isSuperAdmin: above })
      .onConflictDoNothing();

    await getDb()
      .update(schema.users)
      .set({ isSuperAdmin: above })
      .where(eq(schema.users.id, id));
  });

  people.push(id);
  session.userId = id;

  return id;
}

describe.skipIf(!HAS_DB)("the company list", () => {
  afterAll(
    inRequest(async () => {
      for (const company of made) {
        await getDb().delete(schema.tenants).where(eq(schema.tenants.id, company.id));
      }
      for (const id of people) {
        await getDb().delete(schema.users).where(eq(schema.users.id, id));
      }
    }),
  );

  it("refuses everyone who is not above the companies", async () => {
    // Stood down in the database, session untouched: the point of reading the
    // row on every request is that this takes effect now rather than at the
    // next sign-in.
    await admin(false);

    // The guard redirects rather than throwing a refusal: a screen someone is
    // not meant to know about should not announce itself.
    await expect(
      createCompany({ name: "No", adminEmail: "a@b.co" }),
    ).rejects.toThrow(/redirected/);
    expect(redirects.at(-1)).toBe("/dashboard");

    session.userId = null;

    await expect(enterCompany("whatever")).rejects.toThrow(/redirected/);
    expect(redirects.at(-1)).toBe("/signin");
  });

  it("makes a company with its reference data and its first owner", async () => {
    await admin();

    const name = `Made ${stamp}`;
    const result = await createCompany({
      name,
      adminEmail: `Owner-${stamp}@Example.Invalid`,
    });

    expect(result.ok).toBe(true);

    const company = { id: await idOf(name) };

    const [invited, rates] = await acrossTenants(async () => [
      await getDb()
        .select({ email: schema.allowedEmails.email, role: schema.allowedEmails.role })
        .from(schema.allowedEmails)
        .where(eq(schema.allowedEmails.tenantId, company.id)),
      await getDb()
        .select({ id: schema.vatRates.id })
        .from(schema.vatRates)
        .where(eq(schema.vatRates.tenantId, company.id)),
    ]);

    // Lower-cased on the way in, so the invitation matches whatever case the
    // person's Google account reports.
    expect(invited).toEqual([{ email: `owner-${stamp}@example.invalid`, role: "owner" }]);
    // An empty rate table would let the first report run and produce nothing.
    expect(rates.length).toBeGreaterThan(0);
  });

  it("lets two companies share a name and keeps them apart anyway", async () => {
    await admin();

    // The model this is here to hold: a name is a label its owner may change,
    // so it cannot be what tells companies apart. Refusing the second one
    // would be treating the name as an identifier again.
    const name = `Twice ${stamp}`;

    expect((await createCompany({ name, adminEmail: "a@b.co" })).ok).toBe(true);
    expect((await createCompany({ name, adminEmail: "c@d.co" })).ok).toBe(true);

    const rows = await acrossTenants(() =>
      getDb().select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.name, name)),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);

    for (const row of rows) made.push({ id: row.id, name });
  });

  it("leaves a membership behind when it steps into a company", async () => {
    const id = await admin();
    const name = `Entered ${stamp}`;

    await createCompany({ name, adminEmail: "a@b.co" });

    const company = { id: await idOf(name) };

    expect((await enterCompany(company.id)).ok).toBe(true);

    const [invited, members] = await acrossTenants(async () => [
      await getDb()
        .select({ email: schema.allowedEmails.email, role: schema.allowedEmails.role })
        .from(schema.allowedEmails)
        .where(eq(schema.allowedEmails.tenantId, company.id)),
      await getDb()
        .select({ userId: schema.memberships.userId })
        .from(schema.memberships)
        .where(eq(schema.memberships.tenantId, company.id)),
    ]);

    // The access list, because that is what every check reads: a membership
    // alone would leave the admin holding a company that refuses them. And
    // visible, not silent — the company's own owner sees this address in their
    // team list and can suspend it, which is the whole argument for granting it
    // rather than making super-admins a special case inside every check.
    expect(invited).toContainEqual({ email: `${id}@example.invalid`, role: "owner" });
    expect(members.map((row) => row.userId)).toContain(id);
  });

  it("counts what it lists without reading anybody's rows", async () => {
    await admin();

    const ids = new Set(made.map((company) => company.id));
    const listed = await allCompanies();
    const mine = listed.filter((company) => ids.has(company.id));

    expect(mine.length).toBe(ids.size);

    // The company just entered has two people on its list — the owner it was
    // created with and the admin who stepped in — and one it has not been
    // entered has one. Listed, not counted: the addresses are what the screen
    // shows, and a count would not tell the two companies apart either way.
    const entered = mine.find((company) => company.name === `Entered ${stamp}`);
    const untouched = mine.find((company) => company.name === `Made ${stamp}`);

    expect(entered?.people.map((person) => person.email).sort()).toEqual(
      [`${session.userId}@example.invalid`, "a@b.co"].sort(),
    );
    expect(untouched?.people).toEqual([
      { email: `owner-${stamp}@example.invalid`, role: "owner", isActive: true },
    ]);
    // Nothing has been uploaded to any of them, and the list says so rather
    // than inventing a date.
    expect(mine.every((company) => company.lastUploadAt === null)).toBe(true);
  });
});
