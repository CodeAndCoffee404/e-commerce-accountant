import { afterAll, describe, expect, it } from "vitest";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { buildYearPeriod } from "@/lib/ingest/period";
import { ensurePeriodFor, ensurePeriods, loadPeriodConfiguration } from "@/lib/periods/ensure";
import { PERIODS_CHANNEL, SCHEDULE_KEY, type PeriodSchedule } from "@/lib/periods/schedule";

/**
 * Opening periods is the one piece the calendar cannot prove on its own: that
 * calling it twice is the same as calling it once. Everything downstream —
 * the cron, the page load that catches up behind it — leans on that.
 */

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const created: string[] = [];

afterAll(async () => {
  if (!HAS_DB || created.length === 0) return;

  const db = getDb();

  for (const tenantId of created) {
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  }
});

async function tenant(schedule?: Partial<PeriodSchedule>): Promise<string> {
  const db = getDb();
  const suffix = created.length + Date.now();
  const [row] = await db
    .insert(schema.tenants)
    .values({ name: `Periods ${suffix}`, slug: `periods-${suffix}` })
    .returning({ id: schema.tenants.id });

  created.push(row.id);

  if (schedule) {
    await db.insert(schema.channelRules).values({
      tenantId: row.id,
      channel: PERIODS_CHANNEL,
      key: SCHEDULE_KEY,
      value: schedule,
    });
  }

  return row.id;
}

async function labels(tenantId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ label: schema.periods.label, start: schema.periods.startDate })
    .from(schema.periods)
    .where(eq(schema.periods.tenantId, tenantId));

  return rows
    .sort((a, b) => a.start.localeCompare(b.start) || a.label.localeCompare(b.label))
    .map((row) => row.label);
}

describe.skipIf(!HAS_DB)("opening periods", () => {
  it("opens the month and the quarter being lived through on the first run", async () => {
    const tenantId = await tenant();

    const opened = await ensurePeriods(tenantId, "2026-08-22");

    expect(opened.map((period) => period.label).sort()).toEqual(["2026.08 August", "2026.Q3"]);
    expect(await labels(tenantId)).toEqual(["2026.Q3", "2026.08 August"]);
  });

  it("does nothing at all the second time", async () => {
    const tenantId = await tenant();

    await ensurePeriods(tenantId, "2026-08-22");
    const again = await ensurePeriods(tenantId, "2026-08-22");

    expect(again).toEqual([]);
    expect(await labels(tenantId)).toHaveLength(2);
  });

  it("opens the new month when the day rolls over, and only that", async () => {
    const tenantId = await tenant();

    await ensurePeriods(tenantId, "2026-08-22");
    const opened = await ensurePeriods(tenantId, "2026-09-01");

    expect(opened.map((period) => period.label)).toEqual(["2026.09 September"]);
  });

  it("catches up months a silent scheduler missed, in one call", async () => {
    const tenantId = await tenant();

    await ensurePeriods(tenantId, "2026-08-22");
    const opened = await ensurePeriods(tenantId, "2026-12-05");

    expect(opened.map((period) => period.label).sort()).toEqual([
      "2026.09 September",
      "2026.10 October",
      "2026.11 November",
      "2026.12 December",
      "2026.Q4",
    ]);
  });

  it("never opens a period from before the schedule started", async () => {
    const tenantId = await tenant();

    await ensurePeriods(tenantId, "2026-08-22");

    // July belongs to the quarter that was opened, but the month itself began
    // before this tenant had a schedule and is not invented after the fact.
    expect(await labels(tenantId)).not.toContain("2026.07 July");
  });

  it("starts a granularity turned on later from where it is turned on", async () => {
    const tenantId = await tenant({
      month: true,
      quarter: true,
      year: false,
      fiscalYearStartMonth: 1,
    });

    await ensurePeriods(tenantId, "2026-08-22");

    await getDb()
      .update(schema.channelRules)
      .set({ value: { month: true, quarter: true, year: true, fiscalYearStartMonth: 1 } })
      .where(
        and(
          eq(schema.channelRules.tenantId, tenantId),
          eq(schema.channelRules.channel, PERIODS_CHANNEL),
          eq(schema.channelRules.key, SCHEDULE_KEY),
        ),
      );

    const opened = await ensurePeriods(tenantId, "2026-08-22");

    expect(opened.map((period) => period.label)).toEqual(["2026.Y"]);
  });

  it("remembers where each granularity started", async () => {
    const tenantId = await tenant();

    await ensurePeriods(tenantId, "2026-08-22");

    const { anchors } = await loadPeriodConfiguration(tenantId);

    expect(anchors).toEqual({ month: "2026-08-01", quarter: "2026-07-01" });
  });

  it("honours a fiscal year that does not start in January", async () => {
    const tenantId = await tenant({
      month: false,
      quarter: false,
      year: true,
      fiscalYearStartMonth: 4,
    });

    const opened = await ensurePeriods(tenantId, "2027-02-15");

    expect(opened.map((period) => period.label)).toEqual(["2026.Y"]);
    expect(opened[0].startDate).toBe("2026-04-01");
    expect(opened[0].endDate).toBe("2027-03-31");
  });

  it("keeps two tenants' periods apart under the same label", async () => {
    const one = await tenant();
    const two = await tenant();

    await ensurePeriods(one, "2026-08-22");
    const opened = await ensurePeriods(two, "2026-08-22");

    expect(opened.map((period) => period.label).sort()).toEqual(["2026.08 August", "2026.Q3"]);
  });
});

describe.skipIf(!HAS_DB)("the period a file belongs to", () => {
  it("opens one for a month the schedule never reached, marked as an upload", async () => {
    const tenantId = await tenant();

    await ensurePeriods(tenantId, "2026-08-22");

    const id = await ensurePeriodFor(tenantId, {
      label: "2026.03 March",
      granularity: "month",
      start: "2026-03-01",
      end: "2026-03-31",
    });

    const [row] = await getDb()
      .select()
      .from(schema.periods)
      .where(eq(schema.periods.id, id));

    expect(row.origin).toBe("upload");
    expect(row.label).toBe("2026.03 March");
  });

  it("returns the existing period rather than a second one", async () => {
    const tenantId = await tenant();

    const [august] = await ensurePeriods(tenantId, "2026-08-01");
    const id = await ensurePeriodFor(tenantId, {
      label: "2026.08 August",
      granularity: "month",
      start: "2026-08-01",
      end: "2026-08-31",
    });

    expect(id).toBe(august.id);
    // The calendar opened it, and a file arriving later does not rewrite that.
    expect(august.origin).toBe("schedule");
  });

  it("opens a granularity this tenant does not schedule rather than refusing the file", async () => {
    const tenantId = await tenant({
      month: true,
      quarter: false,
      year: false,
      fiscalYearStartMonth: 1,
    });

    await ensurePeriods(tenantId, "2026-08-22");

    const id = await ensurePeriodFor(tenantId, buildYearPeriod(2026));
    const [row] = await getDb().select().from(schema.periods).where(eq(schema.periods.id, id));

    expect(row.granularity).toBe("year");
    expect(row.origin).toBe("upload");
  });
});
