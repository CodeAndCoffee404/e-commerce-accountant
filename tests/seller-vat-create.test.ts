import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Adding a registration a company holds.
 *
 * The screen had no way to do it, and that was not a gap in the interface — it
 * was a company that could never build. Seeding stopped handing registrations
 * out (a VAT number names a legal entity, so it is not a default), the only
 * other insert copies a row that already exists, and a run refuses outright
 * when the month wants a registration the company does not hold. So a company
 * created after that was told to add a number on a screen with no way to add
 * one.
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
const { acrossTenants, withTenant } = await import("@/lib/db/tenant");
const { createSellerVatNumber } = await import("@/lib/reference/actions");
const { loadReferenceData } = await import("@/lib/reference/queries");
const { inRequest } = await import("./helpers/request-scope");

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const stamp = `${process.pid}-${Date.now()}`;
const tenants: string[] = [];
const people: string[] = [];

async function company(): Promise<string> {
  return acrossTenants(async () => {
    const [row] = await getDb()
      .insert(schema.tenants)
      .values({ name: `Create ${stamp}` })
      .returning({ id: schema.tenants.id });

    const id = `owner-create-${stamp}`;

    await getDb()
      .insert(schema.users)
      .values({ id, email: `${id}@example.invalid` })
      .onConflictDoNothing();

    await getDb()
      .insert(schema.allowedEmails)
      .values({ tenantId: row.id, email: `${id}@example.invalid`, role: "owner", isActive: true })
      .onConflictDoNothing();

    tenants.push(row.id);
    people.push(id);
    session.userId = id;
    session.tenantId = row.id;

    return row.id;
  });
}

function rows(id: string) {
  return withTenant(id, () => loadReferenceData(id)).then((data) => data.sellerVatNumbers);
}

describe.skipIf(!HAS_DB)("adding a registration", () => {
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

  it("gives a company with none the one its reports ask for", async () => {
    const id = await company();

    // What a company created today actually starts with: nothing.
    expect(await rows(id)).toHaveLength(0);

    const saved = await createSellerVatNumber({
      country: "EE",
      scheme: "UNION-OSS",
      vatNumber: "EE102013089",
      validFrom: "2026-01-01",
    });

    expect(saved.ok).toBe(true);

    const [row] = await rows(id);

    expect({ country: row.country, scheme: row.scheme, vatNumber: row.vatNumber }).toEqual({
      country: "EE",
      scheme: "UNION-OSS",
      vatNumber: "EE102013089",
    });
  });

  it("refuses a second one-stop registration while the first is in force", async () => {
    const id = await company();

    await createSellerVatNumber({
      country: "EE",
      scheme: "UNION-OSS",
      vatNumber: "EE102013089",
      validFrom: "2026-01-01",
    });

    // One-stop is registered in a single member state and covers every distance
    // sale. Two in force is not a company with options — it is a company whose
    // reports cannot say which number is theirs. The unique index does not
    // catch this: it is per country, and the second could be registered
    // somewhere else entirely.
    const second = await createSellerVatNumber({
      country: "PL",
      scheme: "UNION-OSS",
      vatNumber: "PL5263307678",
      validFrom: "2026-02-01",
    });

    expect(second.ok).toBe(false);
    expect(await rows(id)).toHaveLength(1);
  });

  it("refuses a duplicate of a pair already in force", async () => {
    const id = await company();

    await createSellerVatNumber({
      country: "FR",
      scheme: "REGULAR",
      vatNumber: "FR23888800463",
      validFrom: "2026-01-01",
    });

    const again = await createSellerVatNumber({
      country: "FR",
      scheme: "REGULAR",
      vatNumber: "FR00000000000",
      validFrom: "2026-03-01",
    });

    expect(again.ok).toBe(false);
    expect(await rows(id)).toHaveLength(1);
  });

  it("allows a country's local registration alongside the one-stop one", async () => {
    const id = await company();

    await createSellerVatNumber({
      country: "EE",
      scheme: "UNION-OSS",
      vatNumber: "EE102013089",
      validFrom: "2026-01-01",
    });

    // A company can hold both: sales taxed in Estonia take the local number,
    // distance sales take the one-stop one. Same country, different regime.
    const local = await createSellerVatNumber({
      country: "EE",
      scheme: "REGULAR",
      vatNumber: "EE999999999",
      validFrom: "2026-01-01",
    });

    expect(local.ok).toBe(true);
    expect(await rows(id)).toHaveLength(2);
  });
});
