import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google/publish", () => ({ publishRun: async () => ({ uploaded: 0, failed: 0 }) }));

const { getDb, schema } = await import("@/lib/db");
const { classify } = await import("@/lib/ingest/classify");
const { parseSpreadsheet } = await import("@/lib/ingest/parse");
const { availablePeriods } = await import("@/lib/reports/queries");
const { runReport } = await import("@/lib/reports/run");
const { ingestSourceFile } = await import("@/lib/uploads/ingest");
const { CUSTOM_REPORTS_CHANNEL } = await import("@/modules/reports/custom-slice-config");

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const PERIOD = "2026.07 July";

/**
 * The whole path of a client-defined report: a definition saved as a rule, a
 * card that appears for it, a run that builds it under its own name, and the
 * refusals when the definition is absent. This is the feature's contract —
 * a new report without a deployment — proven end to end.
 */
describe.skipIf(!HAS_DB)("a report the client defined themselves", () => {
  const db = getDb();
  let tenantId = "";

  beforeAll(async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: "Custom report test", slug: `custom-${process.pid}` })
      .returning({ id: schema.tenants.id });

    tenantId = tenant.id;

    await db.insert(schema.channelRules).values({
      tenantId,
      channel: CUSTOM_REPORTS_CHANNEL,
      key: "orders-by-country",
      value: {
        name: "Orders by country",
        groupBy: ["countryCode", "currency"],
        measures: ["rows", "gross"],
        filters: { datasets: ["shopify"], countries: [], currencies: [], transactionTypes: [], skus: [] },
      },
      note: "Test definition.",
    });

    const file = path.resolve(
      process.cwd(),
      "tests/fixtures/from-csv/Geyser shopify sales report - 2026.07 July.csv",
    );
    const bytes = readFileSync(file);
    const filename = path.basename(file);
    const parsed = await parseSpreadsheet(bytes, filename);

    if (!parsed.ok) throw new Error(parsed.message);

    const classified = classify(parsed.grid, filename);

    if (!classified.ok) throw new Error(classified.message);

    const [row] = await db
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
  }, 300_000);

  afterAll(async () => {
    if (tenantId) await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  });

  it("offers one card per definition, described from the definition itself", async () => {
    const state = await availablePeriods(tenantId);
    const custom = state.custom_slice;

    expect(custom.enabled).toBe(true);
    expect(custom.ready).toContain(PERIOD);
    expect(custom.variants).toEqual([
      {
        key: "orders-by-country",
        name: "Orders by country",
        summary: expect.stringContaining("Groups by Country, Currency"),
      },
    ]);
  });

  it("builds under the definition's own name, and the run records which one", async () => {
    const outcome = await runReport({
      tenantId,
      reportType: "custom_slice",
      periodLabel: PERIOD,
      requestedBy: null,
      variant: "orders-by-country",
    });

    if (!outcome.ok) throw new Error(outcome.message);

    expect(outcome.result.sheets).toHaveLength(1);
    expect(outcome.result.sheets[0].name).toBe("Orders by country");
    // Rows grouped, plus the totals row.
    expect(outcome.result.sheets[0].rows.length).toBeGreaterThan(1);

    const [run] = await db
      .select({ variant: schema.reportRuns.variant, snapshot: schema.reportRuns.rulesSnapshot })
      .from(schema.reportRuns)
      .where(eq(schema.reportRuns.tenantId, tenantId));

    expect(run.variant).toBe("orders-by-country");

    // Reproducibility: the definition the run used is inside its snapshot, so
    // editing the definition later cannot orphan the explanation.
    const snapshot = run.snapshot as { channelRules: { channel: string; key: string }[] };

    expect(
      snapshot.channelRules.some(
        (rule) => rule.channel === CUSTOM_REPORTS_CHANNEL && rule.key === "orders-by-country",
      ),
    ).toBe(true);

    const [artifact] = await db
      .select({ filename: schema.reportArtifacts.filename })
      .from(schema.reportArtifacts)
      .innerJoin(schema.reportRuns, eq(schema.reportRuns.id, schema.reportArtifacts.reportRunId))
      .where(eq(schema.reportRuns.tenantId, tenantId));

    expect(artifact.filename).toBe(`Orders by country - ${PERIOD}.xlsx`);
  }, 300_000);

  it("refuses a run that names no definition, or a deleted one", async () => {
    const unnamed = await runReport({
      tenantId,
      reportType: "custom_slice",
      periodLabel: PERIOD,
      requestedBy: null,
    });

    if (unnamed.ok) throw new Error("a run without a definition was expected to be refused");

    expect(unnamed.message).toContain("saved definition");

    const missing = await runReport({
      tenantId,
      reportType: "custom_slice",
      periodLabel: PERIOD,
      requestedBy: null,
      variant: "deleted-long-ago",
    });

    if (missing.ok) throw new Error("a run for a deleted definition was expected to be refused");

    expect(missing.message).toContain("deleted-long-ago");
    expect(missing.message).toContain("Custom reports");
  }, 300_000);
});
