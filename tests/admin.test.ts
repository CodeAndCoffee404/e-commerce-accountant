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

const session: { userId: string | null; isSuperAdmin: boolean; tenantId: string } = {
  userId: null,
  isSuperAdmin: false,
  tenantId: "00000000-0000-0000-0000-000000000000",
};

const redirects: string[] = [];

vi.mock("@/auth", () => ({
  auth: async () =>
    session.userId
      ? {
          user: { id: session.userId, email: `${session.userId}@example.invalid`, name: null },
          tenantId: session.tenantId,
          isSuperAdmin: session.isSuperAdmin,
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
const slugs: string[] = [];
const people: string[] = [];

async function admin(): Promise<string> {
  const id = `admin-${stamp}`;

  await acrossTenants(() =>
    getDb()
      .insert(schema.users)
      .values({ id, email: `${id}@example.invalid`, isSuperAdmin: true })
      .onConflictDoNothing(),
  );
  people.push(id);
  session.userId = id;
  session.isSuperAdmin = true;

  return id;
}

describe.skipIf(!HAS_DB)("the company list", () => {
  afterAll(
    inRequest(async () => {
      for (const slug of slugs) {
        await getDb().delete(schema.tenants).where(eq(schema.tenants.slug, slug));
      }
      for (const id of people) {
        await getDb().delete(schema.users).where(eq(schema.users.id, id));
      }
    }),
  );

  it("refuses everyone who is not above the companies", async () => {
    await admin();
    session.isSuperAdmin = false;

    // The guard redirects rather than throwing a refusal: a screen someone is
    // not meant to know about should not announce itself.
    await expect(createCompany({ name: "No", slug: "no", adminEmail: "a@b.co" })).rejects.toThrow(
      /redirected/,
    );
    expect(redirects.at(-1)).toBe("/dashboard");

    session.userId = null;
    session.isSuperAdmin = false;

    await expect(enterCompany("whatever")).rejects.toThrow(/redirected/);
    expect(redirects.at(-1)).toBe("/signin");
  });

  it("makes a company with its reference data and its first owner", async () => {
    await admin();

    const slug = `made-${stamp}`;

    slugs.push(slug);

    const made = await createCompany({
      name: `Made ${stamp}`,
      slug,
      adminEmail: `Owner-${stamp}@Example.Invalid`,
    });

    expect(made.ok).toBe(true);

    const [company] = await acrossTenants(() =>
      getDb()
        .select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(eq(schema.tenants.slug, slug)),
    );

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

  it("refuses a short name that is taken", async () => {
    await admin();

    const slug = `twice-${stamp}`;

    slugs.push(slug);

    expect((await createCompany({ name: "First", slug, adminEmail: "a@b.co" })).ok).toBe(true);

    const second = await createCompany({ name: "Second", slug, adminEmail: "c@d.co" });

    expect(second.ok).toBe(false);
    expect(second.ok === false && second.message).toContain(slug);
  });

  it("leaves a membership behind when it steps into a company", async () => {
    const id = await admin();
    const slug = `entered-${stamp}`;

    slugs.push(slug);
    await createCompany({ name: `Entered ${stamp}`, slug, adminEmail: "a@b.co" });

    const [company] = await acrossTenants(() =>
      getDb()
        .select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(eq(schema.tenants.slug, slug)),
    );

    expect((await enterCompany(company.id)).ok).toBe(true);

    const members = await acrossTenants(() =>
      getDb()
        .select({ userId: schema.memberships.userId, role: schema.memberships.role })
        .from(schema.memberships)
        .where(eq(schema.memberships.tenantId, company.id)),
    );

    // Visible, not silent: the company's own owner sees this in their team
    // list, which is the whole argument for granting it rather than making
    // super-admins a special case inside every check.
    expect(members).toEqual([{ userId: id, role: "owner" }]);
  });

  it("counts what it lists without reading anybody's rows", async () => {
    await admin();

    const listed = await allCompanies();
    const mine = listed.filter((company) => slugs.includes(company.slug));

    expect(mine.length).toBe(slugs.length);
    expect(mine.every((company) => typeof company.members === "number")).toBe(true);
  });
});
