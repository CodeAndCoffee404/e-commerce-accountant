import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * A company is its id; its name is only what it is called.
 *
 * So the name is the owner's to change, and changing it moves nothing: the
 * rows the company owns, the folder its files live under and the access list
 * all point at the id. This file holds both halves of that — the rename works,
 * and everything keyed to the company is untouched by it.
 */

const session: { userId: string | null; tenantId: string | null } = {
  userId: null,
  tenantId: null,
};

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

const { getDb, schema } = await import("@/lib/db");
const { acrossTenants } = await import("@/lib/db/tenant");
const { renameCompany } = await import("@/lib/company/actions");
const { inRequest } = await import("./helpers/request-scope");

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const stamp = `${process.pid}-${Date.now()}`;
const tenants: string[] = [];
const people: string[] = [];

/** A company with one person in it, at the role given. */
async function company(role: "owner" | "accountant"): Promise<string> {
  const id = await acrossTenants(async () => {
    const [row] = await getDb()
      .insert(schema.tenants)
      .values({ name: `Before ${role} ${stamp}` })
      .returning({ id: schema.tenants.id });

    const userId = `${role}-${stamp}`;

    await getDb()
      .insert(schema.users)
      .values({ id: userId, email: `${userId}@example.invalid` })
      .onConflictDoNothing();

    await getDb()
      .insert(schema.allowedEmails)
      .values({ tenantId: row.id, email: `${userId}@example.invalid`, role, isActive: true });

    tenants.push(row.id);
    people.push(userId);
    session.userId = userId;
    session.tenantId = row.id;

    return row.id;
  });

  return id;
}

function nameOf(id: string): Promise<string | undefined> {
  return acrossTenants(async () => {
    const [row] = await getDb()
      .select({ name: schema.tenants.name })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, id));

    return row?.name;
  });
}

describe.skipIf(!HAS_DB)("renaming a company", () => {
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

  it("lets the owner change it, and leaves the company itself alone", async () => {
    const id = await company("owner");

    // Something keyed to the company, to show what a rename does not touch.
    await acrossTenants(() =>
      getDb().insert(schema.vatRates).values({
        tenantId: id,
        country: "ES",
        rate: "21",
        validFrom: "2020-01-01",
      }),
    );

    const result = await renameCompany({ name: `After ${stamp}` });

    expect(result.ok).toBe(true);
    expect(await nameOf(id)).toBe(`After ${stamp}`);

    const [rates, logged] = await acrossTenants(async () => [
      await getDb().select().from(schema.vatRates).where(eq(schema.vatRates.tenantId, id)),
      await getDb()
        .select({ action: schema.auditLog.action, payload: schema.auditLog.payload })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.tenantId, id)),
    ]);

    // Still this company's row, under the same id: the rename was a label.
    expect(rates).toHaveLength(1);

    // And it says what the company used to be called, which is the whole use
    // of the entry — somebody comes back to a name they do not recognise.
    expect(logged).toContainEqual({
      action: "company.renamed",
      payload: { from: `Before owner ${stamp}`, to: `After ${stamp}` },
    });
  });

  it("refuses everyone else", async () => {
    const id = await company("accountant");
    const before = await nameOf(id);

    const result = await renameCompany({ name: `Accountant tried ${stamp}` });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("owner");
    expect(await nameOf(id)).toBe(before);
  });

  it("refuses a name that is not one", async () => {
    await company("owner");

    expect((await renameCompany({ name: " " })).ok).toBe(false);
    expect((await renameCompany({ name: "x".repeat(200) })).ok).toBe(false);
  });
});
