import { and, count, eq, sql } from "drizzle-orm";

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
  const ids = sql.param([...fileIds]);

  const [files, counts] = await Promise.all([
    db
      .select({ id: schema.sourceFiles.id, detectionMeta: schema.sourceFiles.detectionMeta })
      .from(schema.sourceFiles)
      .where(
        and(
          eq(schema.sourceFiles.tenantId, tenantId),
          sql`${schema.sourceFiles.id} = any(${ids}::uuid[])`,
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
      .where(
        and(
          eq(schema.transactions.tenantId, tenantId),
          sql`${schema.transactions.sourceFileId} = any(${ids}::uuid[])`,
        ),
      )
      .groupBy(schema.transactions.sourceFileId, schema.transactions.isCurrent),
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
    });
  }

  return result;
}
