import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Drive publishing is the one part of a run that reaches outside; it has its
// own retry and is not what this is about.
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
const { giveRegistrations } = await import("./helpers/registrations");
const { runReport } = await import("@/lib/reports/run");
const { ingestSourceFile } = await import("@/lib/uploads/ingest");
const { inRequest } = await import("./helpers/request-scope");

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const PERIOD = "2026.07 July";

const CHANNELS = [
  "tests/fixtures/from-csv/Allegro sales report - 2026.07 July.csv",
  "tests/fixtures/from-xlsx/Cdiscount sales report - 2026.07 July.csv",
  "tests/fixtures/from-csv/Geyser shopify sales report - 2026.07 July.csv",
];

/**
 * A tenant whose channel rules are missing does not get a smaller report. Every
 * row of every channel fails to be recognised and is skipped one at a time, and
 * the run used to finish successfully with a nearly empty sheet and several
 * hundred warnings nobody reads. It has to refuse instead.
 */
describe.skipIf(!HAS_DB)("building without the channel rules", () => {
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
      .values({ name: "Rules guard test" })
      .returning({ id: schema.tenants.id });

    tenantId = tenant.id;

    for (const relative of CHANNELS) {
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

  it("refuses, and names the rules that are missing", inRequest(async () => {
    const outcome = await runReport({
      tenantId,
      reportType: "off_amazon_sales",
      periodLabel: PERIOD,
      requestedBy: null,
    });

    // Narrowed rather than asserted, so the failure message below is typed.
    if (outcome.ok) throw new Error("the run was expected to be refused, and was not");

    expect(outcome.message).toContain("allegro / operation_types");
    expect(outcome.message).toContain("cdiscount / defaults");
    expect(outcome.message).toContain("shopify_geyser / defaults");
    // Says where to go, not only what is wrong.
    expect(outcome.message).toContain("Restore missing");

    // Nothing was written: a failed run must not leave a workbook behind that
    // looks like a result.
    const artifacts = await db()
      .select({ id: schema.reportArtifacts.id })
      .from(schema.reportArtifacts)
      .innerJoin(
        schema.reportRuns,
        eq(schema.reportRuns.id, schema.reportArtifacts.reportRunId),
      )
      .where(eq(schema.reportRuns.tenantId, tenantId));

    expect(artifacts).toEqual([]);
  }), 300_000);

  it("builds once the defaults are restored", inRequest(async () => {
    await seedReferenceData(tenantId);
    // Registrations are entered, not seeded — see the helper.
    await giveRegistrations(tenantId);

    const outcome = await runReport({
      tenantId,
      reportType: "off_amazon_sales",
      periodLabel: PERIOD,
      requestedBy: null,
    });

    expect(outcome.ok).toBe(true);

    const [run] = await db()
      .select({ stats: schema.reportRuns.stats, status: schema.reportRuns.status })
      .from(schema.reportRuns)
      .where(
        and(eq(schema.reportRuns.tenantId, tenantId), eq(schema.reportRuns.status, "succeeded")),
      );

    const stats = run.stats as { outputRows?: number; warnings?: string[] };

    // The point of the guard: with the rules in place the rows arrive, rather
    // than every one of them being skipped as unrecognised.
    expect(stats.outputRows ?? 0).toBeGreaterThan(0);
    expect(stats.warnings ?? []).not.toContain("Shopify: the defaults rule is missing");
  }), 300_000);
});
