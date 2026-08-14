import { and, desc, eq, ilike } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

export type UploadRow = {
  id: string;
  filename: string;
  label: string | null;
  /** The enum value, for linking into the transactions filter. */
  dataset: string | null;
  country: string | null;
  period: string | null;
  status: string;
  sizeBytes: number;
  uploadedAt: Date;
  format: string | null;
  rowCount: number | null;
  periodSource: string | null;
};

type DetectionMeta = {
  format?: string;
  rowCount?: number;
  periodSource?: string;
};

export type UploadFilters = {
  dataset?: string;
  period?: string;
  status?: string;
  /** Matched against the filename, case-insensitively. */
  search?: string;
};

export type UploadOptions = {
  datasets: string[];
  periods: string[];
  statuses: string[];
};

/** Values that actually occur, so a filter can never select nothing. */
export async function uploadFilterOptions(tenantId: string): Promise<UploadOptions> {
  const rows = await getDb()
    .selectDistinct({
      dataset: schema.sourceFiles.datasetLabel,
      period: schema.sourceFiles.periodLabel,
      status: schema.sourceFiles.status,
    })
    .from(schema.sourceFiles)
    .where(eq(schema.sourceFiles.tenantId, tenantId));

  const unique = (values: (string | null)[]) =>
    [...new Set(values.filter((value): value is string => value !== null))].sort();

  return {
    datasets: unique(rows.map((row) => row.dataset)),
    // Newest first: that is the period being worked on.
    periods: unique(rows.map((row) => row.period)).reverse(),
    statuses: unique(rows.map((row) => row.status)),
  };
}

export async function listUploads(
  tenantId: string,
  filters: UploadFilters = {},
  limit = 200,
): Promise<UploadRow[]> {
  const clauses = [eq(schema.sourceFiles.tenantId, tenantId)];

  if (filters.dataset) clauses.push(eq(schema.sourceFiles.datasetLabel, filters.dataset));
  if (filters.period) clauses.push(eq(schema.sourceFiles.periodLabel, filters.period));
  if (filters.status) {
    clauses.push(
      eq(
        schema.sourceFiles.status,
        filters.status as (typeof schema.sourceFileStatus.enumValues)[number],
      ),
    );
  }
  if (filters.search) {
    clauses.push(ilike(schema.sourceFiles.originalFilename, `%${filters.search}%`));
  }

  const rows = await getDb()
    .select({
      id: schema.sourceFiles.id,
      filename: schema.sourceFiles.originalFilename,
      label: schema.sourceFiles.datasetLabel,
      dataset: schema.sourceFiles.dataset,
      country: schema.sourceFiles.countryCode,
      period: schema.sourceFiles.periodLabel,
      status: schema.sourceFiles.status,
      sizeBytes: schema.sourceFiles.sizeBytes,
      uploadedAt: schema.sourceFiles.uploadedAt,
      detectionMeta: schema.sourceFiles.detectionMeta,
    })
    .from(schema.sourceFiles)
    .where(and(...clauses))
    .orderBy(desc(schema.sourceFiles.uploadedAt))
    .limit(limit);

  return rows.map((row) => {
    const meta = (row.detectionMeta ?? {}) as DetectionMeta;

    return {
      id: row.id,
      filename: row.filename,
      label: row.label,
      dataset: row.dataset,
      country: row.country,
      period: row.period,
      status: row.status,
      sizeBytes: row.sizeBytes,
      uploadedAt: row.uploadedAt,
      format: meta.format ?? null,
      rowCount: meta.rowCount ?? null,
      periodSource: meta.periodSource ?? null,
    };
  });
}
