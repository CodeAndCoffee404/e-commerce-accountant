import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = { tenantId: "", userId: "close-user" };

// Signed in, and nothing else about access stubbed: the actions ask the real
// permission code what an owner may do, and `requireUser` names the company
// for the queries below, exactly as it does in a request.
vi.mock("@/auth", () => ({
  auth: async () => ({
    user: {
      id: session.userId,
      name: "Close test",
      email: "close@example.invalid",
      image: null,
    },
    tenantId: session.tenantId,
    role: "owner" as const,
  }),
}));
// The report writes its workbook to Blob storage, which wants credentials the
// test environment has no reason to hold. The bytes are not what these tests
// are about — the rows that produced them are — so the store is stubbed and
// the run gets a key back, as it would in production.
vi.mock("@vercel/blob", () => ({
  put: async (key: string) => ({ pathname: key, url: `https://blob.test/${key}` }),
  del: async () => undefined,
}));
vi.mock("@/lib/google/publish", () => ({ publishRun: async () => ({ uploaded: 0, failed: 0 }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/audit/record", () => ({ record: async () => undefined }));

const { getDb, schema } = await import("@/lib/db");
const { classify } = await import("@/lib/ingest/classify");
const { parseSpreadsheet } = await import("@/lib/ingest/parse");
const { seedReferenceData } = await import("@/lib/reference/seed");
const { buildReport } = await import("@/lib/reports/actions");
const { loadDashboard } = await import("@/lib/dashboard/queries");
const { periodContaining } = await import("@/lib/periods/calendar");
const { ingestSourceFile } = await import("@/lib/uploads/ingest");
const { inRequest } = await import("./helpers/request-scope");

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const PERIOD = "2026.07 July";

describe.skipIf(!HAS_DB)("the dashboard", () => {
  // A function, not a handle: `describe.skipIf` still runs this body to collect
  // its tests, so opening the connection here would throw before the skip
  // could take effect — which is how these suites came to fail on a checkout
  // with no connection string instead of skipping. Called only from inside a
  // test that is really running.
  const db = () => getDb();

  beforeAll(async () => {
    const [tenant] = await db()
      .insert(schema.tenants)
      .values({ name: "Close test", slug: `close-${process.pid}` })
      .returning({ id: schema.tenants.id });

    session.tenantId = tenant.id;
    // runReport records who asked, and the column is a real foreign key.
    await db()
      .insert(schema.users)
      .values({ id: session.userId, email: `${session.userId}@example.invalid` })
      .onConflictDoNothing();
    await seedReferenceData(session.tenantId);

    for (const relative of [
      "tests/fixtures/from-csv/Allegro sales report - 2026.07 July.csv",
      "tests/fixtures/from-xlsx/Cdiscount sales report - 2026.07 July.csv",
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
          tenantId: session.tenantId,
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

      const ingested = await ingestSourceFile(row.id, session.tenantId, parsed.grid);

      // registerUpload records these after ingest; the direct path used here
      // has to do the same for the checklist to show row counts.
      await db()
        .update(schema.sourceFiles)
        .set({ detectionMeta: { sourceRows: ingested.sourceRows, mappedRows: ingested.inserted } })
        .where(eq(schema.sourceFiles.id, row.id));
    }
  }, 300_000);

  afterAll(async () => {
    if (session.tenantId) {
      await db().delete(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
    }
    await db().delete(schema.users).where(eq(schema.users.id, session.userId));
  });

  it("derives the checklist from the enabled reports and marks what landed", inRequest(async () => {
    const data = await loadDashboard(session.tenantId);

    expect(data.month).toBe(PERIOD);
    // 1 VAT + 10 marketplaces + 3 channels.
    expect(data.items).toHaveLength(14);

    const allegro = data.items.find((item) => item.key === "allegro")!;

    expect(allegro.uploaded).toBe(true);
    expect(allegro.rows).toBeGreaterThan(0);

    // Required and absent: the VAT file and all ten marketplaces.
    expect(data.items.find((item) => item.key === "amazon_vat")!.uploaded).toBe(false);
    expect(
      data.items.filter((item) => item.key.startsWith("amazon_monthly:") && !item.uploaded),
    ).toHaveLength(10);

    const offAmazon = data.reports.find((report) => report.id === "off_amazon_sales")!;

    expect(offAmazon.state).toBe("ready");

    const byCurrency = data.reports.find((report) => report.id === "sales_by_currency")!;

    expect(byCurrency.state).toBe("waiting");
    expect(byCurrency.missing.join(" ")).toContain("Amazon VAT");

    // The matrix carries the same facts, and now also the month nobody has
    // uploaded for yet: the calendar opened it, and its column of "no" is what
    // says the work has not started rather than the month not existing.
    const current = periodContaining("month", new Date().toISOString().slice(0, 10), {
      month: true,
      quarter: true,
      year: false,
      fiscalYearStartMonth: 1,
    }).label;

    expect(data.matrix.months).toEqual([current, PERIOD]);

    const uploads = data.matrix.groups.find((group) => group.kind === "upload")!;

    expect(uploads.rows.find((row) => row.key === "allegro")!.cells).toEqual(["no", "yes"]);

    // The reports band spans the same months and says which of them were
    // actually built — nothing has been built here yet, so it is all dashes.
    const built = data.matrix.groups.find((group) => group.kind === "report")!;

    expect(built.rows.length).toBeGreaterThan(0);
    expect(built.rows.every((row) => row.cells.every((cell) => cell === "no"))).toBe(true);

    // ...and the screen still opens on the month being worked on, not on the
    // empty one that has only just begun.
    expect(data.month).toBe(PERIOD);
  }));

  it("builds what is ready, and what built drops off the dashboard's own build-all shortlist", inRequest(async () => {
    // The dashboard's Build button computes its own target list from
    // `data.reports` (state "ready" or stale) and calls this same action
    // once per target, in the browser — there is no server-side "build
    // everything" action anymore. This reproduces exactly that shortlist.
    const before = await loadDashboard(session.tenantId);
    const targets = before.reports.filter((report) => report.state === "ready" || report.stale);

    // Everything these uploads are enough for. Sorted, because the shortlist's
    // order is the dashboard's business and not this test's.
    expect(targets.map((t) => t.id).sort()).toEqual(
      ["allegro_zoho_invoice", "off_amazon_sales", "shopify_zoho_invoice"].sort(),
    );
    // Not ready, so not in the shortlist — a build-all that tried it anyway
    // would fail its way through every missing report.
    expect(targets.some((t) => t.id === "sales_by_currency")).toBe(false);

    const built: string[] = [];

    for (const target of targets) {
      const result = await buildReport({ reportType: target.id, periodLabel: PERIOD });

      if (result.ok) {
        built.push(target.id);
        continue;
      }

      // The two Zoho invoices key their line items on SKU, and this fixture
      // carries codes the seeded mapping does not know. Stopping at that gate
      // is the right answer — it is the modal the client answers — so the
      // shortlist is allowed to survive it, but nothing else is.
      expect(result.needsSkuMapping ?? []).not.toHaveLength(0);
    }

    expect(built).toEqual(["off_amazon_sales"]);

    const after = await loadDashboard(session.tenantId);
    const offAmazon = after.reports.find((report) => report.id === "off_amazon_sales")!;

    expect(offAmazon.state).toBe("built");
    expect(offAmazon.stale).toBe(false);

    // A second pass finds only what the SKU gate stopped: what built is gone
    // from the shortlist, and the count the dashboard shows agrees with it.
    const second = after.reports.filter((report) => report.state === "ready" || report.stale);

    expect(second.map((report) => report.id).sort()).toEqual(
      ["allegro_zoho_invoice", "shopify_zoho_invoice"].sort(),
    );
    expect(after.buildable).toBe(second.length);
  }), 300_000);

  it("marks the built report stale after a re-upload of its source", inRequest(async () => {
    // The same Allegro file, salted, replaces the original slice.
    const file = path.resolve(
      process.cwd(),
      "tests/fixtures/from-csv/Allegro sales report - 2026.07 July.csv",
    );
    const bytes = readFileSync(file);
    const parsed = await parseSpreadsheet(bytes, path.basename(file));

    if (!parsed.ok) throw new Error(parsed.message);

    const classified = classify(parsed.grid, path.basename(file));

    if (!classified.ok) throw new Error(classified.message);

    const [row] = await db()
      .insert(schema.sourceFiles)
      .values({
        tenantId: session.tenantId,
        originalFilename: "Allegro sales report - corrected.csv",
        sizeBytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).update("salt").digest("hex"),
        blobKey: "test/allegro-corrected",
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

    await ingestSourceFile(row.id, session.tenantId, parsed.grid);

    const data = await loadDashboard(session.tenantId);
    const offAmazon = data.reports.find((report) => report.id === "off_amazon_sales")!;

    // The workbook still exists and still traces — but it no longer reflects
    // the ledger, and the page has to say so rather than show a green tick.
    expect(offAmazon.state).toBe("built");
    expect(offAmazon.stale).toBe(true);

    // And it is back on the shortlist it had left, alongside the two the SKU
    // gate is still holding.
    const shortlist = data.reports.filter((report) => report.state === "ready" || report.stale);

    expect(shortlist.map((report) => report.id)).toContain("off_amazon_sales");
    expect(data.buildable).toBe(shortlist.length);
  }), 300_000);
});
