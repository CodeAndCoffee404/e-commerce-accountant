import { and, eq, isNull, ne, sql } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import type { Grid } from "@/lib/ingest/classify";
import type { MappedTransaction } from "@/lib/ingest/mappers/types";
import { channelModule } from "@/modules/channels/registry";
import { toNumeric } from "@/lib/ingest/numbers";
import type { Period } from "@/lib/ingest/period";
import type { AmazonCountry } from "@/lib/ingest/datasets";

export type IngestResult = {
  /**
   * Non-blank rows below the header — what the file offered.
   *
   * Recorded so the interface can answer "did everything get in" without
   * re-reading the file. A mapper drops rows on purpose (a fee line, a blank),
   * and the difference between this and `inserted` is exactly what an
   * accountant wants explained.
   */
  sourceRows: number;
  inserted: number;
  supersededFiles: number;
  supersededRows: number;
  needsAttention: number;
  missingColumns: string[];
};

/**
 * Postgres allows 65535 bound parameters per statement, and a transaction row
 * binds about thirty. Five hundred rows a batch leaves plenty of headroom.
 */
const BATCH = 500;

/**
 * Parses one uploaded file into the ledger, replacing whatever the same slice
 * held before.
 *
 * The slice is (tenant, dataset, country, period) — never the individual row.
 * Three of the five channels have no stable per-row identifier: Cdiscount
 * repeats its invoice id on half the lines, and Amazon VAT repeats its event id
 * ninety times in a single file. Matching rows between two versions of a file
 * is therefore impossible, and pretending otherwise would either duplicate or
 * silently drop transactions. See PLAN §2.1.
 *
 * Nothing is deleted. Superseded rows keep `is_current = false` so a report
 * generated earlier can still be traced back to the numbers it used.
 */
export async function ingestSourceFile(
  fileId: string,
  tenantId: string,
  grid: Grid,
): Promise<IngestResult> {
  const db = getDb();

  const [file] = await db
    .select()
    .from(schema.sourceFiles)
    .where(and(eq(schema.sourceFiles.id, fileId), eq(schema.sourceFiles.tenantId, tenantId)))
    .limit(1);

  if (!file) throw new Error("File not found.");
  if (!file.dataset || !file.periodLabel || !file.periodStart || !file.periodEnd) {
    throw new Error("The file has not been classified — there is nothing to parse.");
  }

  const period: Period = {
    label: file.periodLabel,
    granularity: file.periodGranularity ?? "month",
    start: file.periodStart,
    end: file.periodEnd,
  };

  const mapped = channelModule(file.dataset).map({
    grid,
    headerRowIndex: file.headerRowIndex ?? 0,
    country: (file.countryCode as AmazonCountry | null) ?? null,
    period,
  });

  const headerRowIndex = file.headerRowIndex ?? 0;
  const sourceRows = grid
    .slice(headerRowIndex + 1)
    .filter((row) => row.some((value) => (value ?? "").trim() !== "")).length;

  // One transaction: a half-applied replacement would leave the ledger holding
  // two versions of the same slice, which is exactly what this prevents.
  return db.transaction(async (tx) => {
    const superseded = await supersedeSlice(tx, {
      fileId,
      tenantId,
      dataset: file.dataset!,
      countryCode: file.countryCode,
      periodLabel: file.periodLabel!,
    });

    await insertTransactions(tx, {
      fileId,
      tenantId,
      period,
      countryCode: file.countryCode,
      rows: mapped.rows,
    });

    await tx
      .update(schema.sourceFiles)
      .set({ status: "parsed" })
      .where(eq(schema.sourceFiles.id, fileId));

    return {
      sourceRows,
      inserted: mapped.rows.length,
      supersededFiles: superseded.files,
      supersededRows: superseded.rows,
      needsAttention: mapped.rows.filter((row) => row.needsAttention).length,
      missingColumns: mapped.missingColumns,
    };
  });
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type Slice = {
  fileId: string;
  tenantId: string;
  dataset: (typeof schema.datasetId.enumValues)[number];
  countryCode: string | null;
  periodLabel: string;
};

async function supersedeSlice(
  tx: Transaction,
  slice: Slice,
): Promise<{ files: number; rows: number }> {
  // A null country is a real value here — Allegro and Shopify report one
  // country per channel, so `= null` would match nothing and the slice would
  // never be replaced.
  const sameCountry =
    slice.countryCode === null
      ? isNull(schema.sourceFiles.countryCode)
      : eq(schema.sourceFiles.countryCode, slice.countryCode);

  const previous = await tx
    .select({ id: schema.sourceFiles.id })
    .from(schema.sourceFiles)
    .where(
      and(
        eq(schema.sourceFiles.tenantId, slice.tenantId),
        eq(schema.sourceFiles.dataset, slice.dataset),
        eq(schema.sourceFiles.periodLabel, slice.periodLabel),
        sameCountry,
        ne(schema.sourceFiles.id, slice.fileId),
        ne(schema.sourceFiles.status, "superseded"),
      ),
    );

  if (previous.length === 0) return { files: 0, rows: 0 };

  const ids = previous.map((row) => row.id);

  const rows = await tx
    .update(schema.transactions)
    .set({ isCurrent: false })
    .where(
      and(
        eq(schema.transactions.tenantId, slice.tenantId),
        eq(schema.transactions.isCurrent, true),
        sql`${schema.transactions.sourceFileId} = any(${sql.param(ids)}::uuid[])`,
      ),
    )
    .returning({ id: schema.transactions.id });

  await tx
    .update(schema.sourceFiles)
    .set({ status: "superseded", supersededByFileId: slice.fileId })
    .where(sql`${schema.sourceFiles.id} = any(${sql.param(ids)}::uuid[])`);

  return { files: ids.length, rows: rows.length };
}

async function insertTransactions(
  tx: Transaction,
  input: {
    fileId: string;
    tenantId: string;
    period: Period;
    countryCode: string | null;
    rows: MappedTransaction[];
  },
): Promise<void> {
  for (let start = 0; start < input.rows.length; start += BATCH) {
    const batch = input.rows.slice(start, start + BATCH).map((row) => ({
      tenantId: input.tenantId,
      sourceFileId: input.fileId,
      sourceRowNumber: row.sourceRowNumber,

      dataset: row.dataset,
      channel: row.channel,
      countryCode: row.countryCode ?? input.countryCode,

      periodLabel: input.period.label,
      periodStart: input.period.start,
      periodEnd: input.period.end,

      naturalKey: row.naturalKey,
      occurredOn: row.occurredOn,
      transactionType: row.transactionType,

      currency: row.currency,
      gross: toNumeric(row.gross),
      vatAmount: toNumeric(row.vatAmount),
      netAmount: toNumeric(row.netAmount),
      vatRate: toNumeric(row.vatRate),

      departureCountry: row.departureCountry,
      arrivalCountry: row.arrivalCountry,
      sellerVatNumber: row.sellerVatNumber,
      buyerVatNumber: row.buyerVatNumber,
      taxScheme: row.taxScheme,

      sku: row.sku,
      quantity: toNumeric(row.quantity),

      needsAttention: row.needsAttention,
      attentionReason: row.attentionReason,
      raw: row.raw,
    }));

    await tx.insert(schema.transactions).values(batch);
  }
}
