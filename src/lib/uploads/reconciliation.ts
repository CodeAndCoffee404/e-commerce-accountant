import { and, count, eq, sql, sum } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

export type FileReconciliation = {
  /** Non-blank rows below the header, recorded when the file was parsed. */
  sourceRows: number | null;
  /** Rows the mapper produced at that moment. */
  mappedRows: number | null;
  /** Rows in the ledger now, which differs once a later upload supersedes. */
  currentRows: number;
  supersededRows: number;
  needsAttention: number;
  totals: { currency: string; gross: string; vat: string }[];
};

type DetectionMeta = { sourceRows?: number; mappedRows?: number };

/**
 * Answers the first question an accountant asks: did everything get in?
 *
 * Three counts rather than one, because they mean different things. The file
 * offered so many rows; the mapper accepted so many, dropping fee lines and
 * blanks on purpose; the ledger holds so many now, which drops again once a
 * corrected upload supersedes this one. A single "rows" number would hide all
 * three distinctions and look wrong whenever any of them applied.
 */
export async function reconcileFiles(
  tenantId: string,
  fileIds: readonly string[],
): Promise<Map<string, FileReconciliation>> {
  const result = new Map<string, FileReconciliation>();

  if (fileIds.length === 0) return result;

  const db = getDb();
  const inScope = sql`${schema.transactions.sourceFileId} = any(${sql.param([...fileIds])}::uuid[])`;

  const [files, counts, totals] = await Promise.all([
    db
      .select({ id: schema.sourceFiles.id, detectionMeta: schema.sourceFiles.detectionMeta })
      .from(schema.sourceFiles)
      .where(
        and(
          eq(schema.sourceFiles.tenantId, tenantId),
          sql`${schema.sourceFiles.id} = any(${sql.param([...fileIds])}::uuid[])`,
        ),
      ),

    db
      .select({
        fileId: schema.transactions.sourceFileId,
        isCurrent: schema.transactions.isCurrent,
        rows: count(),
        flagged: sql<number>`count(*) filter (where ${schema.transactions.needsAttention})::int`,
      })
      .from(schema.transactions)
      .where(and(eq(schema.transactions.tenantId, tenantId), inScope))
      .groupBy(schema.transactions.sourceFileId, schema.transactions.isCurrent),

    // Grouped by currency: Allegro settles in five, and one summed figure
    // across them would be a number with no meaning.
    db
      .select({
        fileId: schema.transactions.sourceFileId,
        currency: schema.transactions.currency,
        gross: sum(schema.transactions.gross),
        vat: sum(schema.transactions.vatAmount),
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.tenantId, tenantId),
          eq(schema.transactions.isCurrent, true),
          inScope,
        ),
      )
      .groupBy(schema.transactions.sourceFileId, schema.transactions.currency),
  ]);

  for (const file of files) {
    const meta = (file.detectionMeta ?? {}) as DetectionMeta;
    const rows = counts.filter((row) => row.fileId === file.id);

    result.set(file.id, {
      sourceRows: meta.sourceRows ?? null,
      mappedRows: meta.mappedRows ?? null,
      currentRows: rows.find((row) => row.isCurrent)?.rows ?? 0,
      supersededRows: rows.find((row) => !row.isCurrent)?.rows ?? 0,
      needsAttention: rows.find((row) => row.isCurrent)?.flagged ?? 0,
      totals: totals
        .filter((row) => row.fileId === file.id && row.currency !== null)
        .map((row) => ({
          currency: row.currency!,
          gross: row.gross ?? "0",
          vat: row.vat ?? "0",
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
    });
  }

  return result;
}
