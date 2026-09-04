import { afterAll, afterEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { acrossTenants } from "@/lib/db/tenant";
import { GET } from "@/app/api/cron/daily/route";

/**
 * The scheduler's door. It writes rows and answers to nobody logged in, so the
 * one thing that must never be taken on trust is who is allowed through it.
 */

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const SECRET = "test-cron-secret";
const created: string[] = [];

function call(authorization?: string): Promise<Response> {
  return GET(
    new Request("https://example.test/api/cron/daily", {
      headers: authorization ? { authorization } : {},
    }),
  );
}

afterEach(() => {
  delete process.env.CRON_SECRET;
});

afterAll(async () => {
  // Guarded before the scope, not inside it: opening one needs a connection,
  // and this file's database tests skip themselves when there is none.
  if (!HAS_DB || created.length === 0) return;

  await acrossTenants(async () => {
    for (const tenantId of created) {
      await getDb().delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    }
  });
});

describe("who the scheduler lets in", () => {
  it("refuses a caller with no credentials", async () => {
    process.env.CRON_SECRET = SECRET;

    expect((await call()).status).toBe(401);
  });

  it("refuses the wrong secret", async () => {
    process.env.CRON_SECRET = SECRET;

    expect((await call(`Bearer ${SECRET}-nearly`)).status).toBe(401);
    expect((await call(`Bearer ${"x".repeat(SECRET.length)}`)).status).toBe(401);
  });

  it("refuses the right secret in the wrong scheme", async () => {
    process.env.CRON_SECRET = SECRET;

    expect((await call(SECRET)).status).toBe(401);
    expect((await call(`Basic ${SECRET}`)).status).toBe(401);
  });

  it("refuses everyone when no secret is configured", async () => {
    // Fail closed: a forgotten variable must not open a writing endpoint to
    // the world, and an empty bearer must not become the password.
    expect((await call()).status).toBe(401);
    expect((await call("Bearer ")).status).toBe(401);
    expect((await call("Bearer undefined")).status).toBe(401);
  });
});

describe.skipIf(!HAS_DB)("what the scheduler does once it is in", () => {
  it("opens the periods due for every tenant, and nothing on a second run", async () => {
    process.env.CRON_SECRET = SECRET;

    const suffix = Date.now();
    const [tenant] = await getDb()
      .insert(schema.tenants)
      .values({ name: `Cron ${suffix}`, slug: `cron-${suffix}` })
      .returning({ id: schema.tenants.id });

    created.push(tenant.id);

    const first = await call(`Bearer ${SECRET}`);
    const body = (await first.json()) as {
      opened: { tenant: string; periods: string[] }[];
      failed: unknown[];
      date: string;
    };

    expect(first.status).toBe(200);
    expect(body.failed).toEqual([]);
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const mine = body.opened.find((entry) => entry.tenant === `Cron ${suffix}`);

    expect(mine?.periods).toHaveLength(2);

    const second = await call(`Bearer ${SECRET}`);
    const repeat = (await second.json()) as { opened: { tenant: string }[] };

    expect(second.status).toBe(200);
    expect(repeat.opened.find((entry) => entry.tenant === `Cron ${suffix}`)).toBeUndefined();
  });
});
