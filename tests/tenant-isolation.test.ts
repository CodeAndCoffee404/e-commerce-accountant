import { eq, is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, rootDb, schema } from "@/lib/db";
import { acrossTenants, withTenant } from "@/lib/db/tenant";

import { inRequest } from "./helpers/request-scope";

/**
 * The proof that the separation is the database's job now, not the query's.
 *
 * Everything else in this suite runs inside `acrossTenants`, which stands the
 * check down so tests can build rows for several companies. This file is the
 * one that must not: it looks from outside, where a real forgotten `where`
 * would be, and asks what Postgres hands back.
 */

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

// Skipping is a convenience for a checkout with no database. On CI it would be
// this file quietly not running — which is the same as not having it.
if (!HAS_DB && process.env.CI === "true") {
  throw new Error(
    "tests/tenant-isolation.test.ts needs a database. Without one the isolation is untested, " +
      "and untested isolation is the thing this file exists to prevent.",
  );
}

const stamp = `${process.pid}-${Date.now()}`;
const companies: string[] = [];

async function company(name: string): Promise<string> {
  const [row] = await getDb()
    .insert(schema.tenants)
    .values({ name: `Isolation ${name} ${stamp}`, slug: `isolation-${name}-${stamp}` })
    .returning({ id: schema.tenants.id });

  companies.push(row.id);

  return row.id;
}

/** One row of each shape a company owns, so "sees nothing of theirs" has something to see. */
async function fill(tenantId: string, marker: string): Promise<void> {
  await withTenant(tenantId, async () => {
    await getDb().insert(schema.sourceFiles).values({
      tenantId,
      originalFilename: `${marker}.csv`,
      sizeBytes: 1,
      sha256: `sha-${marker}-${stamp}`,
      blobKey: `test/${marker}-${stamp}`,
      blobUrl: "https://example.invalid/test",
    });

    await getDb().insert(schema.vatRates).values({
      tenantId,
      country: "ES",
      rate: "21",
      validFrom: "2026-01-01",
    });
  });
}

describe.skipIf(!HAS_DB)("what one company can reach of another", () => {
  afterAll(
    inRequest(async () => {
      for (const id of companies) {
        await getDb().delete(schema.tenants).where(eq(schema.tenants.id, id));
      }
    }),
  );

  it("hands back nothing at all when no company has been named", async () => {
    const a = await acrossTenants(() => company("a"));

    await fill(a, "a");

    // The shape of a forgotten `where`: a perfectly ordinary query, outside
    // any scope. Before this change it returned every company's rows.
    const rows = await rootDb().select().from(schema.sourceFiles);

    expect(rows).toHaveLength(0);
  });

  it("shows one company only its own rows", async () => {
    const [a, b] = await acrossTenants(async () => [await company("b1"), await company("b2")]);

    await fill(a, "b1");
    await fill(b, "b2");

    const seen = await withTenant(a, () => getDb().select().from(schema.sourceFiles));

    expect(seen.map((row) => row.originalFilename)).toEqual([`b1.csv`]);
  });

  it("hands back nothing even when the query asks for the other company by name", async () => {
    const [a, b] = await acrossTenants(async () => [await company("c1"), await company("c2")]);

    await fill(a, "c1");
    await fill(b, "c2");

    // A correctly written query, aimed at the wrong company — a bug the old
    // arrangement had no answer to, since the `where` was the whole defence.
    const seen = await withTenant(a, () =>
      getDb().select().from(schema.sourceFiles).where(eq(schema.sourceFiles.tenantId, b)),
    );

    expect(seen).toHaveLength(0);
  });

  it("refuses to write a row into another company", async () => {
    const [a, b] = await acrossTenants(async () => [await company("d1"), await company("d2")]);

    const refused = await withTenant(a, () =>
      getDb().insert(schema.sourceFiles).values({
        tenantId: b,
        originalFilename: "smuggled.csv",
        sizeBytes: 1,
        sha256: `sha-d-${stamp}`,
        blobKey: `test/d-${stamp}`,
        blobUrl: "https://example.invalid/test",
      }),
    ).then(
      () => null,
      (error: Error) => error,
    );

    // Checked by reason, not merely that something threw: a typo in the values
    // above would throw too, and prove nothing. The driver wraps the failure,
    // so the reason can be one level down.
    expect(refused).toBeInstanceOf(Error);
    expect(`${refused?.message} ${(refused?.cause as Error | undefined)?.message ?? ""}`).toMatch(
      /row-level security/,
    );
  });
});

describe.skipIf(!HAS_DB)("every table that carries a company is protected", () => {
  it("has row-level security forced on all of them", async () => {
    // Derived from the schema rather than listed here: a table added later
    // with a company on it and no policy is the exact mistake this catches,
    // and a list written by hand would not have that table in it either.
    const withCompany = Object.values(schema as Record<string, unknown>)
      .filter((value) => is(value, PgTable))
      .map((table) => getTableConfig(table as PgTable))
      .filter((config) => config.columns.some((column) => column.name === "tenant_id"))
      .map((config) => config.name)
      .sort();

    expect(withCompany.length).toBeGreaterThan(10);

    const rows = await rootDb().execute(
      sql`select relname, relforcerowsecurity from pg_class
          where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    );

    const forced = new Map(
      (rows as unknown as { relname: string; relforcerowsecurity: boolean }[]).map((row) => [
        row.relname,
        row.relforcerowsecurity,
      ]),
    );

    for (const table of withCompany) {
      expect(forced.get(table), `${table} does not have row-level security forced`).toBe(true);
    }
  });
});
