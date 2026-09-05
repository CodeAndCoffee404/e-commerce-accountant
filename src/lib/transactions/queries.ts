import { cache } from "react";

import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

export type TransactionFilters = {
  dataset?: string;
  country?: string;
  period?: string;
  type?: string;
  attention?: boolean;
  /** Superseded rows are hidden unless asked for — they are history, not data. */
  includeSuperseded?: boolean;
  page?: number;
  pageSize?: number;
};

export type TransactionRow = {
  id: string;
  sourceFileId: string;
  sourceRowNumber: number;
  sourceFilename: string | null;
  dataset: string;
  countryCode: string | null;
  periodLabel: string;
  occurredOn: string | null;
  transactionType: string | null;
  currency: string | null;
  gross: string | null;
  vatAmount: string | null;
  netAmount: string | null;
  sku: string | null;
  quantity: string | null;
  naturalKey: string | null;
  needsAttention: boolean;
  attentionReason: string | null;
  isCurrent: boolean;
};

export type TransactionPage = {
  rows: TransactionRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type FilterOptions = {
  datasets: string[];
  countries: string[];
  periods: string[];
  types: string[];
};

const DEFAULT_PAGE_SIZE = 50;

function build(tenantId: string, filters: TransactionFilters): SQL {
  const clauses: SQL[] = [eq(schema.transactions.tenantId, tenantId)];

  if (!filters.includeSuperseded) clauses.push(eq(schema.transactions.isCurrent, true));
  if (filters.dataset) {
    clauses.push(
      eq(
        schema.transactions.dataset,
        filters.dataset as (typeof schema.datasetId.enumValues)[number],
      ),
    );
  }
  if (filters.country) clauses.push(eq(schema.transactions.countryCode, filters.country));
  if (filters.period) clauses.push(eq(schema.transactions.periodLabel, filters.period));
  if (filters.type) clauses.push(eq(schema.transactions.transactionType, filters.type));
  if (filters.attention) clauses.push(eq(schema.transactions.needsAttention, true));

  return and(...clauses)!;
}

export async function listTransactions(
  tenantId: string,
  filters: TransactionFilters = {},
): Promise<TransactionPage> {
  const db = getDb();
  const where = build(tenantId, filters);
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, filters.pageSize ?? DEFAULT_PAGE_SIZE));

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(schema.transactions)
    .where(where);

  const rows = await db
    .select({
      id: schema.transactions.id,
      sourceFileId: schema.transactions.sourceFileId,
      sourceRowNumber: schema.transactions.sourceRowNumber,
      sourceFilename: schema.sourceFiles.originalFilename,
      dataset: schema.transactions.dataset,
      countryCode: schema.transactions.countryCode,
      periodLabel: schema.transactions.periodLabel,
      occurredOn: schema.transactions.occurredOn,
      transactionType: schema.transactions.transactionType,
      currency: schema.transactions.currency,
      gross: schema.transactions.gross,
      vatAmount: schema.transactions.vatAmount,
      netAmount: schema.transactions.netAmount,
      sku: schema.transactions.sku,
      quantity: schema.transactions.quantity,
      naturalKey: schema.transactions.naturalKey,
      needsAttention: schema.transactions.needsAttention,
      attentionReason: schema.transactions.attentionReason,
      isCurrent: schema.transactions.isCurrent,
    })
    .from(schema.transactions)
    .leftJoin(schema.sourceFiles, eq(schema.sourceFiles.id, schema.transactions.sourceFileId))
    .where(where)
    .orderBy(desc(schema.transactions.occurredOn), desc(schema.transactions.sourceRowNumber))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows, total, page, pageSize };
}

/**
 * Values that actually occur, so a filter can never select an empty result by
 * offering something the ledger does not contain.
 */
export async function filterOptions(tenantId: string): Promise<FilterOptions> {
  const db = getDb();

  const rows = await db
    .selectDistinct({
      dataset: schema.transactions.dataset,
      country: schema.transactions.countryCode,
      period: schema.transactions.periodLabel,
      type: schema.transactions.transactionType,
    })
    .from(schema.transactions)
    .where(
      and(eq(schema.transactions.tenantId, tenantId), eq(schema.transactions.isCurrent, true)),
    );

  const unique = (values: (string | null)[]) =>
    [...new Set(values.filter((value): value is string => value !== null))].sort();

  return {
    datasets: unique(rows.map((row) => row.dataset)),
    countries: unique(rows.map((row) => row.country)),
    // Newest period first: that is the one being worked on.
    periods: unique(rows.map((row) => row.period)).reverse(),
    types: unique(rows.map((row) => row.type)),
  };
}

/** The original row behind a ledger entry, for drill-down. */
export async function transactionSource(
  tenantId: string,
  transactionId: string,
): Promise<{ filename: string; rowNumber: number; raw: Record<string, string> } | null> {
  const [row] = await getDb()
    .select({
      raw: schema.transactions.raw,
      rowNumber: schema.transactions.sourceRowNumber,
      filename: schema.sourceFiles.originalFilename,
    })
    .from(schema.transactions)
    .leftJoin(schema.sourceFiles, eq(schema.sourceFiles.id, schema.transactions.sourceFileId))
    .where(
      and(
        eq(schema.transactions.id, transactionId),
        // Scoped by tenant as well as id: an id alone must not reach another
        // tenant's data.
        eq(schema.transactions.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    filename: row.filename ?? "—",
    rowNumber: row.rowNumber,
    raw: (row.raw ?? {}) as Record<string, string>,
  };
}

/** Totals for the current filter, so a figure can be checked against a report. */
export async function transactionTotals(
  tenantId: string,
  filters: TransactionFilters = {},
): Promise<{ currency: string; gross: string; vat: string; net: string; rows: number }[]> {
  const rows = await getDb()
    .select({
      currency: schema.transactions.currency,
      gross: sql<string>`coalesce(sum(${schema.transactions.gross}), 0)::text`,
      vat: sql<string>`coalesce(sum(${schema.transactions.vatAmount}), 0)::text`,
      net: sql<string>`coalesce(sum(${schema.transactions.netAmount}), 0)::text`,
      rows: count(),
    })
    .from(schema.transactions)
    .where(build(tenantId, filters))
    .groupBy(schema.transactions.currency);

  return rows
    .filter((row) => row.currency !== null)
    .map((row) => ({ ...row, currency: row.currency! }));
}

/** Current rows a person still has to look at. Drives the sidebar badge. */
/**
 * Rows this company still has to look at — the number on the sidebar badge.
 *
 * Cached for the request: the layout asks for the badge and the dashboard asks
 * again for its own checklist, and there is no reading of this that wants two
 * different answers within one render.
 */
export const countNeedsAttention = cache(async function countNeedsAttention(
  tenantId: string,
): Promise<number> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.tenantId, tenantId),
        eq(schema.transactions.isCurrent, true),
        eq(schema.transactions.needsAttention, true),
      ),
    );

  return row?.value ?? 0;
});
