import { put } from "@vercel/blob";
import Decimal from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { publishRun } from "@/lib/google/publish";
import type { Period } from "@/lib/ingest/period";
import { euroRateOn } from "@/lib/reference/fx";

import { reportDefinition, type ReportTypeId } from "./definitions";
import { generateOffAmazonSales } from "./off-amazon";
import { generateSalesByCurrency } from "./sales-by-currency";
import type { FxSnapshot, GeneratorResult, LedgerRow, RulesSnapshot } from "./types";
import { buildWorkbook, reportFilename } from "./workbook";
import { generateZohoInvoice, missingCountries } from "./zoho-invoice";

export type RunOutcome =
  | {
      ok: true;
      runId: string;
      result: GeneratorResult;
      published: { uploaded: number; failed: number; message: string };
    }
  | { ok: false; runId: string | null; message: string };

/**
 * Builds one report and records what it was built from.
 *
 * The run is written before the work starts and closed after, so a report that
 * failed halfway leaves a row saying so rather than nothing at all. Legacy
 * deleted the whole output folder on any error, which is a clean rollback and
 * also erases the evidence of what went wrong.
 */
export async function runReport(input: {
  tenantId: string;
  reportType: ReportTypeId;
  periodLabel: string;
  requestedBy: string | null;
}): Promise<RunOutcome> {
  const db = getDb();
  const definition = reportDefinition(input.reportType);

  const files = await db
    .select({
      id: schema.sourceFiles.id,
      dataset: schema.sourceFiles.dataset,
      countryCode: schema.sourceFiles.countryCode,
      periodStart: schema.sourceFiles.periodStart,
      periodEnd: schema.sourceFiles.periodEnd,
      granularity: schema.sourceFiles.periodGranularity,
    })
    .from(schema.sourceFiles)
    .where(
      and(
        eq(schema.sourceFiles.tenantId, input.tenantId),
        eq(schema.sourceFiles.periodLabel, input.periodLabel),
        eq(schema.sourceFiles.status, "parsed"),
        inArray(schema.sourceFiles.dataset, [...definition.datasets]),
      ),
    );

  if (files.length === 0) {
    return {
      ok: false,
      runId: null,
      message: `No parsed uploads for "${definition.label}" in ${input.periodLabel}.`,
    };
  }

  const granularity = files[0].granularity ?? "month";

  if (!definition.granularity.includes(granularity)) {
    return {
      ok: false,
      runId: null,
      message: `"${definition.label}" is built per ${definition.granularity.join(" or ")}, and ${input.periodLabel} is a ${granularity}.`,
    };
  }

  const period: Period = {
    label: input.periodLabel,
    granularity,
    start: files[0].periodStart!,
    end: files[0].periodEnd!,
  };

  const [run] = await db
    .insert(schema.reportRuns)
    .values({
      tenantId: input.tenantId,
      reportType: input.reportType,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
      status: "running",
      requestedBy: input.requestedBy,
      startedAt: new Date(),
    })
    .returning({ id: schema.reportRuns.id });

  try {
    await db
      .insert(schema.reportRunSources)
      .values(files.map((file) => ({ reportRunId: run.id, sourceFileId: file.id })));

    if (definition.requiresEveryDataset) {
      const present = new Set(files.map((file) => file.dataset));
      const missing = definition.datasets.filter((dataset) => !present.has(dataset));

      if (missing.length > 0) {
        throw new Error(
          `Missing uploads for ${input.periodLabel}: ${missing.join(", ")}. ` +
            "A report built from the channels that happen to be there understates the rest.",
        );
      }
    }

    const rows = await loadLedger(input.tenantId, period.label, definition.datasets);

    if (input.reportType === "amazon_zoho_invoice") {
      const missing = missingCountries(rows);

      if (missing.length > 0) {
        // Legacy refuses too, and rightly: a missing marketplace does not make
        // a smaller invoice, it makes one that omits a country in silence.
        throw new Error(`Missing Amazon Monthly uploads: ${missing.join(", ")}.`);
      }
    }

    const rules = await loadRules(input.tenantId);
    const fx = await loadFx(rows, period);

    const result = build(input.reportType, rows, { period, rules, fx }, files);

    await storeArtifacts(run.id, input.tenantId, definition.label, period.label, result);

    await db
      .update(schema.reportRuns)
      .set({
        status: "succeeded",
        finishedAt: new Date(),
        rulesSnapshot: rules,
        fxSnapshot: fx,
        stats: {
          ledgerRows: rows.length,
          outputRows: result.sheets.reduce((total, sheet) => total + sheet.rows.length, 0),
          sheets: result.sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows.length })),
          skipped: result.skipped,
          warnings: result.warnings,
          sourceFiles: files.length,
        },
      })
      .where(eq(schema.reportRuns.id, run.id));

    // Delivery is attempted here but never allowed to fail the run: the report
    // is built and downloadable, and Drive being unreachable is a separate
    // problem with its own retry.
    const published = await publishRun(input.tenantId, run.id).catch((error: Error) => ({
      uploaded: 0,
      failed: 0,
      message: error.message,
    }));

    return { ok: true, runId: run.id, result, published };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The report could not be built.";

    // The run stays, marked failed. A report that vanished on error tells the
    // operator nothing about why.
    await db
      .update(schema.reportRuns)
      .set({ status: "failed", finishedAt: new Date(), errorMessage: message })
      .where(eq(schema.reportRuns.id, run.id));

    return { ok: false, runId: run.id, message };
  }
}

/**
 * Writes the workbooks and records them.
 *
 * Sales report by currency ships one file per currency, as legacy did — the
 * client's accountant works one currency at a time. The other two are a single
 * workbook.
 */
async function storeArtifacts(
  runId: string,
  tenantId: string,
  label: string,
  periodLabel: string,
  result: GeneratorResult,
): Promise<void> {
  const separate = result.sheets.length > 1 && result.sheets.every((sheet) => sheet.name.length <= 4);
  const groups = separate
    ? result.sheets.map((sheet) => ({ sheets: [sheet], suffix: sheet.name }))
    : [{ sheets: result.sheets, suffix: undefined }];

  for (const group of groups) {
    const bytes = await buildWorkbook(group.sheets);
    const filename = reportFilename(label, periodLabel, group.suffix);
    const key = `reports/${tenantId}/${runId}/${filename}`;

    // Buffer, not a bare Uint8Array: the Blob client accepts Node's Buffer and
    // this avoids a copy, since Buffer wraps the same memory.
    const blob = await put(key, Buffer.from(bytes), {
      access: "private",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    await getDb().insert(schema.reportArtifacts).values({
      reportRunId: runId,
      kind: "xlsx",
      filename,
      blobKey: blob.pathname,
      sizeBytes: bytes.byteLength,
      driveStatus: "pending",
    });
  }
}

function build(
  reportType: ReportTypeId,
  rows: LedgerRow[],
  context: { period: Period; rules: RulesSnapshot; fx: FxSnapshot },
  files: { dataset: string | null }[],
): GeneratorResult {
  switch (reportType) {
    case "off_amazon_sales":
      return generateOffAmazonSales(rows, context);

    case "amazon_zoho_invoice":
      return generateZohoInvoice(rows, context);

    case "sales_by_currency": {
      // The report reproduces the source columns, so their order comes from the
      // file rather than from a list kept in the code.
      const headers = Object.keys(rows.find((row) => row.dataset === "amazon_vat")?.raw ?? {});

      if (headers.length === 0) throw new Error("The Amazon VAT upload has no rows.");

      void files;

      return generateSalesByCurrency(rows, context, headers);
    }
  }
}

async function loadLedger(
  tenantId: string,
  periodLabel: string,
  datasets: readonly string[],
): Promise<LedgerRow[]> {
  const rows = await getDb()
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.tenantId, tenantId),
        eq(schema.transactions.periodLabel, periodLabel),
        // Superseded rows are history. A report is built from what is current.
        eq(schema.transactions.isCurrent, true),
        inArray(schema.transactions.dataset, [
          ...(datasets as (typeof schema.datasetId.enumValues)[number][]),
        ]),
      ),
    )
    .orderBy(schema.transactions.sourceRowNumber);

  return rows.map((row) => ({
    id: row.id,
    dataset: row.dataset,
    channel: row.channel,
    countryCode: row.countryCode,
    occurredOn: row.occurredOn,
    transactionType: row.transactionType,
    currency: row.currency,
    gross: row.gross === null ? null : new Decimal(row.gross),
    vatAmount: row.vatAmount === null ? null : new Decimal(row.vatAmount),
    netAmount: row.netAmount === null ? null : new Decimal(row.netAmount),
    sku: row.sku,
    quantity: row.quantity === null ? null : new Decimal(row.quantity),
    sourceFileId: row.sourceFileId,
    sourceRowNumber: row.sourceRowNumber,
    raw: (row.raw ?? {}) as Record<string, string>,
  }));
}

async function loadRules(tenantId: string): Promise<RulesSnapshot> {
  const db = getDb();

  const [vatRates, sellerVatNumbers, skuMappings, channelRules] = await Promise.all([
    db
      .select({
        country: schema.vatRates.country,
        rate: schema.vatRates.rate,
        validFrom: schema.vatRates.validFrom,
        validTo: schema.vatRates.validTo,
      })
      .from(schema.vatRates)
      .where(eq(schema.vatRates.tenantId, tenantId)),

    db
      .select({
        country: schema.sellerVatNumbers.country,
        vatNumber: schema.sellerVatNumbers.vatNumber,
      })
      .from(schema.sellerVatNumbers)
      .where(eq(schema.sellerVatNumbers.tenantId, tenantId)),

    db
      .select({
        channel: schema.skuMappings.channel,
        sourceSku: schema.skuMappings.sourceSku,
        targetSku: schema.skuMappings.targetSku,
        itemName: schema.skuMappings.itemName,
        isIgnored: schema.skuMappings.isIgnored,
      })
      .from(schema.skuMappings)
      .where(eq(schema.skuMappings.tenantId, tenantId)),

    db
      .select({
        channel: schema.channelRules.channel,
        key: schema.channelRules.key,
        value: schema.channelRules.value,
      })
      .from(schema.channelRules)
      .where(eq(schema.channelRules.tenantId, tenantId)),
  ]);

  return { vatRates, sellerVatNumbers, skuMappings, channelRules };
}

/**
 * The rate for every currency the period actually contains, as at its last day.
 *
 * The ECB does not publish at weekends, so the lookup takes the most recent
 * publication before that date and records which one it used — an invoice has
 * to be able to say where its rate came from.
 */
async function loadFx(rows: readonly LedgerRow[], period: Period): Promise<FxSnapshot> {
  const currencies = new Set(
    rows.map((row) => row.currency).filter((currency): currency is string => Boolean(currency)),
  );

  const snapshot: FxSnapshot = {};

  for (const currency of currencies) {
    const rate = await euroRateOn(currency, period.end);

    if (rate) {
      snapshot[currency] = {
        rate: rate.rate.toFixed(8),
        rateDate: rate.rateDate,
        source: rate.source,
      };
    }
  }

  return snapshot;
}
