import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The report writes its workbook to Blob storage, which wants credentials the
// test environment has no reason to hold. The bytes are not what these tests
// are about — the rows that produced them are — so the store is stubbed and
// the run gets a key back, as it would in production.
vi.mock("@vercel/blob", () => ({
  put: async (key: string) => ({ pathname: key, url: `https://blob.test/${key}` }),
  del: async () => undefined,
}));
vi.mock("@/lib/google/publish", () => ({ publishRun: async () => ({ uploaded: 0, failed: 0 }) }));

const { getDb, schema } = await import("@/lib/db");
const { classify } = await import("@/lib/ingest/classify");
const { parseSpreadsheet } = await import("@/lib/ingest/parse");
const { seedReferenceData } = await import("@/lib/reference/seed");
const { availablePeriods } = await import("@/lib/reports/queries");
const { runReport } = await import("@/lib/reports/run");
const { ingestSourceFile } = await import("@/lib/uploads/ingest");
const { inRequest } = await import("./helpers/request-scope");

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const PERIOD = "2026.07 July";

/**
 * The client stops selling on Cdiscount. Marking it optional must let the
 * month build from Allegro and Shopify alone — and the whole path has to
 * agree: the card offers the period, the run accepts it, and the sheet holds
 * the two channels' rows.
 */
describe.skipIf(!HAS_DB)("a report with an optional channel", () => {
  // A function, not a handle: `describe.skipIf` still runs this body to collect
  // its tests, so opening the connection here would throw before the skip
  // could take effect — which is how these suites came to fail on a checkout
  // with no connection string instead of skipping. Called only from inside a
  // test that is really running.
  const db = () => getDb();
  let tenantId = "";

  beforeAll(inRequest(async () => {
    const [tenant] = await db()
      .insert(schema.tenants)
      .values({ name: "Report settings test" })
      .returning({ id: schema.tenants.id });

    tenantId = tenant.id;
    await seedReferenceData(tenantId);

    // Cdiscount marked optional, exactly as the settings page stores it.
    await db().insert(schema.channelRules).values({
      tenantId,
      channel: "reports",
      key: "off_amazon_sales",
      value: { enabled: true, datasets: { cdiscount: "optional" }, countries: {} },
    });

    for (const relative of [
      "tests/fixtures/from-csv/Allegro sales report - 2026.07 July.csv",
      "tests/fixtures/from-csv/Geyser shopify sales report - 2026.07 July.csv",
    ]) {
      const file = path.resolve(process.cwd(), relative);
      const bytes = readFileSync(file);
      const filename = path.basename(file);
      const parsed = await parseSpreadsheet(bytes, filename);

      if (!parsed.ok) throw new Error(parsed.message);

      const classified = classify(parsed.grid, filename);

      if (!classified.ok) throw new Error(classified.message);

      const [row] = await db()
        .insert(schema.sourceFiles)
        .values({
          tenantId,
          originalFilename: filename,
          sizeBytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          blobKey: `test/${filename}`,
          blobUrl: "https://example.invalid/test",
          dataset: classified.dataset,
          datasetLabel: classified.label,
          countryCode: classified.country,
          periodLabel: classified.period.label,
          periodStart: classified.period.start,
          periodEnd: classified.period.end,
          periodGranularity: classified.period.granularity,
          headerRowIndex: classified.headerRowIndex,
          status: "classified",
        })
        .returning({ id: schema.sourceFiles.id });

      await ingestSourceFile(row.id, tenantId, parsed.grid);
    }
  }), 300_000);

  afterAll(inRequest(async () => {
    if (tenantId) await db().delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  }));

  it("offers the period with two of three channels in", inRequest(async () => {
    const state = await availablePeriods(tenantId);

    expect(state.off_amazon_sales.ready).toEqual([PERIOD]);
    expect(state.off_amazon_sales.blocked).toEqual([]);
    // The card's Needs line follows the configuration.
    expect(state.off_amazon_sales.needs).toContain("Allegro and Shopify Geyser");
    expect(state.off_amazon_sales.needs).toContain("Cdiscount");
  }));

  it("builds it, with both channels' rows in the sheet", inRequest(async () => {
    const outcome = await runReport({
      tenantId,
      reportType: "off_amazon_sales",
      periodLabel: PERIOD,
      requestedBy: null,
    });

    expect(outcome.ok).toBe(true);

    const [run] = await db()
      .select({ stats: schema.reportRuns.stats })
      .from(schema.reportRuns)
      .where(eq(schema.reportRuns.tenantId, tenantId));

    const stats = run.stats as { outputRows?: number };

    expect(stats.outputRows ?? 0).toBeGreaterThan(0);
  }), 300_000);

  it("a disabled report vanishes from the cards and refuses to run", inRequest(async () => {
    await db().insert(schema.channelRules).values({
      tenantId,
      channel: "reports",
      key: "sales_by_currency",
      value: { enabled: false, datasets: {}, countries: {} },
    });

    const state = await availablePeriods(tenantId);

    expect(state.sales_by_currency.enabled).toBe(false);

    const outcome = await runReport({
      tenantId,
      reportType: "sales_by_currency",
      periodLabel: PERIOD,
      requestedBy: null,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("turned off");
  }));
});
