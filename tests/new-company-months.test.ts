import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * The months a company gets on its first day.
 *
 * Somebody sets up a company in September and configures its reports to begin
 * in June. What they expect on the dashboard is June, July, August and
 * September, with August the month being closed. What they got was September
 * alone, and no way to reach the months they had just named — the anchor that
 * says "periods are never opened before here" was set to whenever the company
 * happened to be created, and nothing consulted the reports at all.
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
const { ensurePeriods } = await import("@/lib/periods/ensure");
const { ANCHOR_KEY, PERIODS_CHANNEL } = await import("@/lib/periods/schedule");
const { loadDashboard } = await import("@/lib/dashboard/queries");
const { inRequest } = await import("./helpers/request-scope");

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const stamp = `${process.pid}-${Date.now()}`;
const tenants: string[] = [];

/** A company created today, with one report told to begin in June. */
async function companyFilingFromJune(): Promise<string> {
  return acrossTenants(async () => {
    const [row] = await getDb()
      .insert(schema.tenants)
      .values({ name: `Months ${stamp}` })
      .returning({ id: schema.tenants.id });

    await getDb().insert(schema.channelRules).values({
      tenantId: row.id,
      channel: "reports",
      key: "off_amazon_sales",
      value: { enabled: true, startsFrom: "2026-06-01" },
    });

    tenants.push(row.id);
    session.tenantId = row.id;

    return row.id;
  });
}

describe.skipIf(!HAS_DB)("a company that files from an earlier month", () => {
  afterAll(
    inRequest(async () => {
      for (const id of tenants) {
        await getDb().delete(schema.tenants).where(eq(schema.tenants.id, id));
      }
    }),
  );

  it("opens every month from the one its reports start in", async () => {
    const id = await companyFilingFromJune();

    // Standing in September, the way the company's first dashboard load does.
    await withTenant(id, () => ensurePeriods(id, "2026-09-05"));

    const data = await withTenant(id, () => loadDashboard(id));

    // Newest first, which is the order the month picker shows them in.
    expect(data.months).toEqual([
      "2026.09 September",
      "2026.08 August",
      "2026.07 July",
      "2026.06 June",
    ]);

    // September is the month being lived through, not the one being closed:
    // through September the accountant is closing August. The screen opens on
    // the month there is work for.
    expect(data.currentMonth).toBe("2026.08 August");
    expect(data.month).toBe("2026.08 August");
  });

  it("agrees with itself about which months exist", inRequest(async () => {
    const id = await companyFilingFromJune();

    const data = await withTenant(id, () => loadDashboard(id));

    // The picker, the history matrix and the checklist are three views of one
    // list, and a month opened during this very load has to be in all of them
    // — not in the picker on this load and the rest on the next.
    expect(data.months).toContain("2026.06 June");
    expect(data.matrix.months).toEqual(data.months);
    expect(data.reports.length).toBeGreaterThan(0);
  }));

  it("catches a company already anchored too late", async () => {
    const id = await companyFilingFromJune();

    // The keys come from the module rather than being spelled out: this test
    // was first written with "anchors" for a column whose key is "anchor",
    // which meant no anchor was stored at all and it passed by taking the
    // first-anchoring path — the one case it was not meant to cover.
    //
    // The state the fix has to reach, not just prevent: the company was
    // created, the anchor was written at September, and only then were the
    // reports told they begin in June. Opening periods again has to move the
    // anchor back rather than leave it where the calendar happened to put it.
    await acrossTenants(() =>
      getDb().insert(schema.channelRules).values({
        tenantId: id,
        channel: PERIODS_CHANNEL,
        key: ANCHOR_KEY,
        value: { month: "2026-09-01", quarter: "2026-07-01" },
      }),
    );

    // No call to `ensurePeriods` here on purpose: opening the dashboard is
    // what this company's owner will actually do, and it has to notice by
    // itself that the earliest month it holds is later than the earliest month
    // a report is filed for.
    const data = await withTenant(id, () => loadDashboard(id));

    expect(data.months).toContain("2026.06 June");
    expect(data.currentMonth).toBe("2026.08 August");
  });
});
