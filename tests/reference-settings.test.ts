import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * What the settings screen is handed, and what it hands back.
 *
 * The screen is the only way a company edits the values its reports print, so
 * a field the query forgets is worse than a field that is missing: the form
 * opens with it blank, the operator fills in whatever looks right, and the
 * save writes that over the truth. `scheme` shipped exactly that way — the
 * column was added, the table and the form were given it, and the query that
 * feeds them was not.
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
const { loadReferenceData } = await import("@/lib/reference/queries");
const { saveSellerVatNumber } = await import("@/lib/reference/actions");
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
      .values({ name: `Reference ${stamp}` })
      .returning({ id: schema.tenants.id });

    const id = `owner-${stamp}`;

    await getDb()
      .insert(schema.users)
      .values({ id, email: `${id}@example.invalid` })
      .onConflictDoNothing();

    await getDb()
      .insert(schema.allowedEmails)
      .values({ tenantId: row.id, email: `${id}@example.invalid`, role: "owner", isActive: true });

    tenants.push(row.id);
    people.push(id);
    session.userId = id;
    session.tenantId = row.id;

    return row.id;
  });
}

describe.skipIf(!HAS_DB)("the VAT registrations screen", () => {
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

  it("shows the scheme it stores", async () => {
    const id = await company();

    await acrossTenants(() =>
      getDb()
        .insert(schema.sellerVatNumbers)
        .values([
          {
            tenantId: id,
            country: "EE",
            scheme: "UNION-OSS",
            vatNumber: "EE102013089",
            validFrom: "2020-01-01",
          },
          {
            tenantId: id,
            country: "FR",
            scheme: "REGULAR",
            vatNumber: "FR23888800463",
            validFrom: "2020-01-01",
          },
        ]),
    );

    // Inside a scope, the way a page reads it: outside one, row-level security
    // answers with nothing at all and the test would pass for the wrong reason.
    const shown = (await withTenant(id, () => loadReferenceData(id))).sellerVatNumbers;

    // The pair is what a report looks a number up by, so a screen that shows
    // the country and not the scheme is showing half of the key.
    expect(
      shown.map((row) => ({ country: row.country, scheme: row.scheme })),
    ).toEqual([
      { country: "EE", scheme: "UNION-OSS" },
      { country: "FR", scheme: "REGULAR" },
    ]);
  });

  it("keeps the scheme through an edit that was not about it", async () => {
    const id = await company();

    await acrossTenants(() =>
      getDb().insert(schema.sellerVatNumbers).values({
        tenantId: id,
        country: "EE",
        scheme: "UNION-OSS",
        vatNumber: "EE102013089",
        validFrom: "2020-01-01",
      }),
    );

    const [before] = (await withTenant(id, () => loadReferenceData(id))).sellerVatNumbers;

    // What the screen sends back is what it was given, plus the one field the
    // person changed. If the form never received the scheme, this is where a
    // one-stop registration quietly becomes a local one.
    const saved = await saveSellerVatNumber({
      id: before.id,
      country: before.country,
      scheme: before.scheme,
      vatNumber: before.vatNumber,
      validFrom: before.validFrom,
      note: "renamed",
    });

    expect(saved.ok).toBe(true);

    const [after] = (await withTenant(id, () => loadReferenceData(id))).sellerVatNumbers;

    expect(after.scheme).toBe("UNION-OSS");
    expect(after.note).toBe("renamed");
  });
});
