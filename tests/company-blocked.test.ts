import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Closing a company, and deleting one.
 *
 * Closed means read-only, and the refusal is Postgres's: a closed company's
 * scope opens its transaction read-only, so every insert, update and delete in
 * it fails whatever the code above forgot to check. That is the thing worth
 * testing — a guard in forty action bodies could be tested forty times and
 * still be missing from the forty-first.
 */

const session: { userId: string | null; tenantId: string | null } = {
  userId: null,
  tenantId: null,
};

const deleted: string[] = [];

vi.mock("@/auth", () => ({
  auth: async () =>
    session.userId && session.tenantId
      ? {
          user: { id: session.userId, email: `${session.userId}@example.invalid`, name: null },
          tenantId: session.tenantId,
        }
      : null,
  unstable_update: async () => null,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`);
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@vercel/blob", () => ({
  del: async (key: string) => {
    deleted.push(key);
  },
}));

const { getDb, schema } = await import("@/lib/db");
const { acrossTenants, withTenant } = await import("@/lib/db/tenant");
const { deleteCompany, setCompanyBlocked } = await import("@/lib/admin/actions");
const { allCompanies } = await import("@/lib/admin/queries");
const { inRequest } = await import("./helpers/request-scope");

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const stamp = `${process.pid}-${Date.now()}`;
const tenants: string[] = [];
const people: string[] = [];

/** A company with a super-admin holding the session, the way the screen has it. */
async function company(name: string): Promise<string> {
  return acrossTenants(async () => {
    const [row] = await getDb()
      .insert(schema.tenants)
      .values({ name: `${name} ${stamp}` })
      .returning({ id: schema.tenants.id });

    const id = `boss-${stamp}`;

    await getDb()
      .insert(schema.users)
      .values({ id, email: `${id}@example.invalid`, isSuperAdmin: true })
      .onConflictDoNothing();

    tenants.push(row.id);
    people.push(id);
    session.userId = id;
    session.tenantId = row.id;

    return row.id;
  });
}

function stillThere(tenantId: string): Promise<number> {
  return acrossTenants(async () =>
    (
      await getDb().select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.id, tenantId))
    ).length,
  );
}

describe.skipIf(!HAS_DB)("a closed company", () => {
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

  it("can still be read, and refuses every write", async () => {
    const id = await company("Closed");

    // Something to read afterwards, written while it is still open.
    await withTenant(id, () =>
      getDb().insert(schema.vatRates).values({
        tenantId: id,
        country: "ES",
        rate: "21",
        validFrom: "2020-01-01",
      }),
    );

    expect((await setCompanyBlocked(id, true)).ok).toBe(true);

    // Reading is the whole point of closed rather than deleted.
    const rates = await withTenant(id, () =>
      getDb().select().from(schema.vatRates).where(eq(schema.vatRates.tenantId, id)),
    );

    expect(rates).toHaveLength(1);

    // And the refusal is the database's, on a plain insert with no guard in
    // front of it — which is what makes it a guarantee rather than a habit.
    const refused = await withTenant(id, () =>
      getDb().insert(schema.vatRates).values({
        tenantId: id,
        country: "DE",
        rate: "19",
        validFrom: "2020-01-01",
      }),
    ).then(
      () => null,
      (error: Error) => error,
    );

    expect(refused).toBeInstanceOf(Error);
    expect(`${refused?.message} ${(refused?.cause as Error | undefined)?.message ?? ""}`).toMatch(
      /read-only transaction/,
    );
  });

  it("takes writes again once it is opened", async () => {
    const id = await company("Reopened");

    await setCompanyBlocked(id, true);
    expect((await setCompanyBlocked(id, false)).ok).toBe(true);

    await withTenant(id, () =>
      getDb().insert(schema.vatRates).values({
        tenantId: id,
        country: "IT",
        rate: "22",
        validFrom: "2020-01-01",
      }),
    );

    const rates = await withTenant(id, () =>
      getDb().select().from(schema.vatRates).where(eq(schema.vatRates.tenantId, id)),
    );

    expect(rates).toHaveLength(1);
  });

  it("is listed as closed, with the people who may come in", async () => {
    const id = await company("Listed");

    await acrossTenants(() =>
      getDb()
        .insert(schema.allowedEmails)
        .values([
          { tenantId: id, email: `owner-${stamp}@example.invalid`, role: "owner", isActive: true },
          { tenantId: id, email: `gone-${stamp}@example.invalid`, role: "viewer", isActive: false },
        ]),
    );

    await setCompanyBlocked(id, true);

    const listed = (await allCompanies()).find((row) => row.id === id);

    expect(listed?.blockedAt).toBeInstanceOf(Date);
    // Suspended addresses are listed too, marked: the screen answers "who may
    // come in", and somebody the owner has stood down is part of that answer.
    expect(listed?.people).toEqual([
      { email: `gone-${stamp}@example.invalid`, role: "viewer", isActive: false },
      { email: `owner-${stamp}@example.invalid`, role: "owner", isActive: true },
    ]);
  });
});

describe.skipIf(!HAS_DB)("deleting a company", () => {
  it("refuses one that is still open", async () => {
    const id = await company("Open");
    const result = await deleteCompany(id, `Open ${stamp}`);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/Close it first/);
    expect(await stillThere(id)).toBe(1);
  });

  it("refuses a name that does not match", async () => {
    const id = await company("Typo");

    await setCompanyBlocked(id, true);

    const result = await deleteCompany(id, "not the name");

    expect(result.ok).toBe(false);
    expect(await stillThere(id)).toBe(1);
  });

  it("removes the company, its rows and its files", async () => {
    const id = await company("Gone");

    await withTenant(id, () =>
      getDb().insert(schema.sourceFiles).values({
        tenantId: id,
        originalFilename: "sales.csv",
        sizeBytes: 1,
        sha256: `sha-${stamp}`,
        blobKey: `uploads/${id}/sales.csv`,
        blobUrl: "https://example.invalid/blob",
      }),
    );

    await setCompanyBlocked(id, true);

    const result = await deleteCompany(id, `Gone ${stamp}`);

    expect(result.ok).toBe(true);
    expect(await stillThere(id)).toBe(0);

    // The rows go by the cascade; the bytes have to be named while the rows
    // that name them still exist, which is the part worth checking.
    expect(deleted).toContain(`uploads/${id}/sales.csv`);

    const orphans = await acrossTenants(() =>
      getDb().select().from(schema.sourceFiles).where(eq(schema.sourceFiles.tenantId, id)),
    );

    expect(orphans).toHaveLength(0);
  });
});
