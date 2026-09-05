import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb, schema } from "@/lib/db";
import { classify } from "@/lib/ingest/classify";
import { parseSpreadsheet } from "@/lib/ingest/parse";
import { availablePeriods } from "@/lib/reports/queries";
import { ingestSourceFile } from "@/lib/uploads/ingest";

import { inRequest } from "./helpers/request-scope";

/**
 * Off-Amazon Sales needs Allegro, Cdiscount and Shopify together, and the card
 * that offers it goes quiet until all three are in. This walks that path with
 * the real exports: the point is not only that the report appears at the end,
 * but that at every step before it the reason is stated rather than left to be
 * guessed at.
 */

// Runs against whatever database is configured; skipped when none is, so the
// suite stays green on a machine with no connection string.
const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const PERIOD = "2026.07 July";

const CHANNELS = [
  {
    file: "tests/fixtures/from-csv/Allegro sales report - 2026.07 July.csv",
    name: "Allegro",
  },
  {
    file: "tests/fixtures/from-xlsx/Cdiscount sales report - 2026.07 July.csv",
    name: "Cdiscount",
  },
  {
    file: "tests/fixtures/from-csv/Geyser shopify sales report - 2026.07 July.csv",
    name: "Shopify EU",
  },
];

describe.skipIf(!HAS_DB)("what a report is still waiting for", () => {
  // A function, not a handle: `describe.skipIf` still runs this body to collect
  // its tests, so opening the connection here would throw before the skip
  // could take effect — which is how these suites came to fail on a checkout
  // with no connection string instead of skipping. Called only from inside a
  // test that is really running.
  const db = () => getDb();
  let tenantId = "";

  afterAll(inRequest(async () => {
    if (tenantId) await db().delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  }));

  async function upload(relative: string) {
    const file = path.resolve(process.cwd(), relative);
    const bytes = readFileSync(file);
    const filename = path.basename(file);
    const parsed = await parseSpreadsheet(bytes, filename);

    if (!parsed.ok) throw new Error(`${filename}: ${parsed.message}`);

    const classified = classify(parsed.grid, filename);

    if (!classified.ok) throw new Error(`${filename}: ${classified.message}`);

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

    return classified.period.label;
  }

  it("names the missing channels, then offers the period once they are all in", inRequest(async () => {
    const [tenant] = await db()
      .insert(schema.tenants)
      .values({ name: "Availability test" })
      .returning({ id: schema.tenants.id });

    tenantId = tenant.id;

    // Nothing uploaded: nothing ready, and nothing to explain either.
    const empty = await availablePeriods(tenantId);

    expect(empty.off_amazon_sales.ready).toEqual([]);
    expect(empty.off_amazon_sales.blocked).toEqual([]);

    for (const [index, channel] of CHANNELS.entries()) {
      // All three fixtures must land on the same period label, or they would
      // never group and the report could never become available.
      expect(await upload(channel.file)).toBe(PERIOD);

      const state = await availablePeriods(tenantId);
      const stillWanted = CHANNELS.slice(index + 1).map((remaining) => remaining.name);

      if (stillWanted.length > 0) {
        expect(state.off_amazon_sales.ready).toEqual([]);
        expect(state.off_amazon_sales.blocked).toEqual([
          // endsOn is null because July is over: what holds the report back is
          // the missing channels, not the calendar.
          { period: PERIOD, missing: stillWanted, endsOn: null },
        ]);
      } else {
        expect(state.off_amazon_sales.ready).toEqual([PERIOD]);
        expect(state.off_amazon_sales.blocked).toEqual([]);
      }
    }
  }), 300_000);

  it("will not offer the Zoho invoice until all ten marketplaces are in", inRequest(async () => {
    const [tenant] = await db()
      .insert(schema.tenants)
      .values({
        name: "Zoho availability test"
      })
      .returning({ id: schema.tenants.id });

    const previous = tenantId;

    tenantId = tenant.id;

    try {
      await upload(
        "tests/fixtures/from-csv/Amazon Monthly Transaction report DE - 2026.07 July.csv",
      );

      const state = await availablePeriods(tenantId);

      // One marketplace of ten, and no VAT report. Legacy refuses this build,
      // so the period must not be offered — and the card has to say which
      // uploads are absent rather than greying out unexplained.
      expect(state.amazon_zoho_invoice.ready).toEqual([]);
      expect(state.amazon_zoho_invoice.blocked).toEqual([
        {
          period: PERIOD,
          missing: ["Amazon VAT", "ES", "IT", "FR", "UK", "SE", "PL", "NL", "IE", "BE"],
          endsOn: null,
        },
      ]);
    } finally {
      await db().delete(schema.tenants).where(eq(schema.tenants.id, tenant.id));
      tenantId = previous;
    }
  }), 300_000);
});
