import { and, desc, eq, ilike } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { PeriodGranularity } from "@/lib/db/schema";
import type { DatasetId } from "@/lib/ingest/datasets";

export type UploadRow = {
  id: string;
  filename: string;
  label: string | null;
  /** The enum value, for linking into the transactions filter. */
  dataset: string | null;
  country: string | null;
  period: string | null;
  /** The period's own start date (ISO), for sorting by real chronology rather than the label text. */
  periodStart: string | null;
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

/** One period the picker can offer — its label, when it starts, and its shape. */
export type PeriodOption = { label: string; start: string; granularity: PeriodGranularity };

export type UploadOptions = {
  datasets: string[];
  periods: PeriodOption[];
  statuses: string[];
};

/**
 * Values a filter can usefully take.
 *
 * Datasets and statuses come from what has been uploaded — offering a filter
 * that selects nothing is worse than not offering it. Periods do not: a period
 * exists before anything is uploaded into it, and being able to ask "what came
 * in for August" and be told "nothing" is the answer someone actually wants on
 * the second of September.
 */
export async function uploadFilterOptions(tenantId: string): Promise<UploadOptions> {
  const [rows, periods] = await Promise.all([
    getDb()
      // The channel itself, not the name it was called when the file arrived.
      // The label is written into the row at upload time, so filtering on it
      // meant a channel that was renamed offered two entries — its old name on
      // old files and its new one on new — and neither selected the other.
      .selectDistinct({
        dataset: schema.sourceFiles.dataset,
        status: schema.sourceFiles.status,
      })
      .from(schema.sourceFiles)
      .where(eq(schema.sourceFiles.tenantId, tenantId)),

    getDb()
      .select({
        label: schema.periods.label,
        start: schema.periods.startDate,
        granularity: schema.periods.granularity,
      })
      .from(schema.periods)
      .where(eq(schema.periods.tenantId, tenantId))
      // Newest first, by when they start rather than by their label: '2026.Y'
      // and '2026.Q3' sort before '2026.07 July' as text, which would put a
      // year in among the months inside it.
      .orderBy(desc(schema.periods.startDate)),
  ]);

  const unique = (values: (string | null)[]) =>
    [...new Set(values.filter((value): value is string => value !== null))].sort();

  return {
    datasets: unique(rows.map((row) => row.dataset)),
    // A file only ever carries a month or a quarter (PLAN §2.1) — the year
    // periods the report screens assemble on their own have no place in a
    // filter over uploads.
    periods: periods
      .filter((period) => period.granularity === "month" || period.granularity === "quarter")
      .map((period) => ({ label: period.label, start: period.start, granularity: period.granularity })),
    statuses: unique(rows.map((row) => row.status)),
  };
}

export async function listUploads(
  tenantId: string,
  filters: UploadFilters = {},
  limit = 200,
): Promise<UploadRow[]> {
  const clauses = [eq(schema.sourceFiles.tenantId, tenantId)];

  if (filters.dataset) clauses.push(eq(schema.sourceFiles.dataset, filters.dataset as DatasetId));
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
      periodStart: schema.sourceFiles.periodStart,
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
      periodStart: row.periodStart,
      status: row.status,
      sizeBytes: row.sizeBytes,
      uploadedAt: row.uploadedAt,
      format: meta.format ?? null,
      rowCount: meta.rowCount ?? null,
      periodSource: meta.periodSource ?? null,
    };
  });
}
