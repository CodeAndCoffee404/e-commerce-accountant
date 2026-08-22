import { afterAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { periodContaining } from "@/lib/periods/calendar";
import { defaultSchedule } from "@/lib/periods/schedule";
import { availablePeriods } from "@/lib/reports/queries";
import { runReport } from "@/lib/reports/run";

/**
 * A quarter holds no files of its own, so everything about it is assembled:
 * which uploads count towards it, and whether it is finished enough to build.
 * Both are new questions — until periods existed, a report's period was
 * whatever label its files carried, and a label is always complete.
 *
 * Dates are computed from the clock rather than written down. "The quarter we
 * are in" is unfinished on every day of the year, and "the one before" is
 * finished on every day of the year; a fixture with the dates spelled out
 * would be right until the quarter turned.
 */

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const TODAY = new Date().toISOString().slice(0, 10);
const SCHEDULE = defaultSchedule();

const RUNNING = periodContaining("quarter", TODAY, SCHEDULE);
const FINISHED = periodContaining(
  "quarter",
  // The day before this quarter began is the last day of the one before it.
  new Date(Date.parse(`${RUNNING.start}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10),
  SCHEDULE,
);

const created: string[] = [];

afterAll(async () => {
  if (!HAS_DB) return;

  for (const tenantId of created) {
    await getDb().delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  }
});

async function tenantWithQuarters(): Promise<string> {
  const db = getDb();
  const suffix = created.length + Date.now();
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: `Quarter ${suffix}`, slug: `quarter-${suffix}` })
    .returning({ id: schema.tenants.id });

  created.push(tenant.id);

  await db.insert(schema.periods).values(
    [RUNNING, FINISHED].map((period) => ({
      tenantId: tenant.id,
      label: period.label,
      granularity: period.granularity,
      startDate: period.start,
      endDate: period.end,
      origin: "schedule" as const,
    })),
  );

  return tenant.id;
}

/**
 * A parsed upload, without the file. Availability reads source_files and never
 * the bytes, so a row is the whole of what it needs — and the alternative,
 * three months of real exports, does not exist as a fixture.
 */
async function upload(
  tenantId: string,
  bounds: { start: string; end: string; granularity: "month" | "quarter" },
): Promise<void> {
  const suffix = `${tenantId}-${bounds.start}-${bounds.granularity}`;

  await getDb().insert(schema.sourceFiles).values({
    tenantId,
    originalFilename: `vat-${bounds.start}.csv`,
    sizeBytes: 1,
    sha256: suffix,
    blobKey: `test/${suffix}`,
    blobUrl: "https://example.invalid/test",
    dataset: "amazon_vat",
    datasetLabel: "Amazon VAT transaction report",
    periodStart: bounds.start,
    periodEnd: bounds.end,
    periodGranularity: bounds.granularity,
    periodLabel: bounds.start,
    status: "parsed",
  });
}

/** The months of a quarter, as three separate uploads would carry them. */
function monthsOf(period: { start: string; end: string }): { start: string; end: string }[] {
  const year = Number(period.start.slice(0, 4));
  const first = Number(period.start.slice(5, 7));

  return [0, 1, 2].map((step) => {
    const month = first + step;
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

    return { start, end: `${year}-${String(month).padStart(2, "0")}-${lastDay}` };
  });
}

describe.skipIf(!HAS_DB)("a quarter assembled from its months", () => {
  it("is offered once it is over, and its months are what feed it", async () => {
    const tenantId = await tenantWithQuarters();

    for (const month of monthsOf(FINISHED)) {
      await upload(tenantId, { ...month, granularity: "month" });
    }

    const state = await availablePeriods(tenantId);

    expect(state.sales_by_currency.ready).toContain(FINISHED.label);
  });

  it("is not offered while it is still running, and says so by date", async () => {
    const tenantId = await tenantWithQuarters();

    // Everything that could have arrived for the current quarter has arrived;
    // what holds the report back is the calendar, and nothing else.
    for (const month of monthsOf(RUNNING)) {
      await upload(tenantId, { ...month, granularity: "month" });
    }

    const state = await availablePeriods(tenantId);

    expect(state.sales_by_currency.ready).not.toContain(RUNNING.label);

    const waiting = state.sales_by_currency.blocked.find(
      (entry) => entry.period === RUNNING.label,
    );

    expect(waiting).toBeDefined();
    expect(waiting!.missing).toEqual([]);
    expect(waiting!.endsOn).toBe(RUNNING.end);
  });

  it("refuses to build while it is still running rather than reporting a short quarter", async () => {
    const tenantId = await tenantWithQuarters();

    for (const month of monthsOf(RUNNING)) {
      await upload(tenantId, { ...month, granularity: "month" });
    }

    const outcome = await runReport({
      tenantId,
      reportType: "sales_by_currency",
      periodLabel: RUNNING.label,
      requestedBy: null,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toContain("not over yet");
    // Refused before a run row was written: there is nothing to explain.
    expect(outcome.runId).toBeNull();
  });

  it("refuses a period that does not exist", async () => {
    const tenantId = await tenantWithQuarters();
    const outcome = await runReport({
      tenantId,
      reportType: "sales_by_currency",
      periodLabel: "1999.Q1",
      requestedBy: null,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toContain("no period");
  });
});

describe.skipIf(!HAS_DB)("a granularity the client does not file", () => {
  it("is not offered, even though the report could build it", async () => {
    const tenantId = await tenantWithQuarters();

    for (const month of monthsOf(FINISHED)) {
      await upload(tenantId, { ...month, granularity: "month" });
    }

    await getDb().insert(schema.channelRules).values({
      tenantId,
      channel: "reports",
      key: "sales_by_currency",
      value: { enabled: true, granularities: { quarter: false } },
    });

    const state = await availablePeriods(tenantId);

    expect(state.sales_by_currency.ready).not.toContain(FINISHED.label);
    expect(state.sales_by_currency.blocked.map((entry) => entry.period)).not.toContain(
      FINISHED.label,
    );
  });

  it("refuses to build it on request as well as hiding it", async () => {
    const tenantId = await tenantWithQuarters();

    for (const month of monthsOf(FINISHED)) {
      await upload(tenantId, { ...month, granularity: "month" });
    }

    await getDb().insert(schema.channelRules).values({
      tenantId,
      channel: "reports",
      key: "sales_by_currency",
      value: { enabled: true, granularities: { quarter: false } },
    });

    const outcome = await runReport({
      tenantId,
      reportType: "sales_by_currency",
      periodLabel: FINISHED.label,
      requestedBy: null,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toContain("not prepared per quarter");
  });
});

describe.skipIf(!HAS_DB)("a channel that sent both a quarter and its months", () => {
  it("is recorded once as a source, not four times", async () => {
    // The sources are written before anything is generated, so this holds
    // whatever the build itself goes on to do — which here is fail for want of
    // a blob store. What is being checked is the selection, not the workbook.
    const tenantId = await tenantWithQuarters();

    await upload(tenantId, {
      start: FINISHED.start,
      end: FINISHED.end,
      granularity: "quarter",
    });

    for (const month of monthsOf(FINISHED)) {
      await upload(tenantId, { ...month, granularity: "month" });
    }

    const outcome = await runReport({
      tenantId,
      reportType: "sales_by_currency",
      periodLabel: FINISHED.label,
      requestedBy: null,
    });

    expect(outcome.runId).not.toBeNull();

    const sources = await getDb()
      .select({ filename: schema.sourceFiles.originalFilename })
      .from(schema.reportRunSources)
      .innerJoin(
        schema.sourceFiles,
        eq(schema.sourceFiles.id, schema.reportRunSources.sourceFileId),
      )
      .where(eq(schema.reportRunSources.reportRunId, outcome.runId!));

    // The quarterly export covers all three months; counting the monthly ones
    // as well would report the quarter's revenue twice.
    expect(sources).toHaveLength(1);
    expect(sources[0].filename).toBe(`vat-${FINISHED.start}.csv`);
  });
});
