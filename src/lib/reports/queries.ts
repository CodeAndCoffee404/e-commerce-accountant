import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

import { REPORT_DEFINITIONS, type ReportTypeId } from "./definitions";

export type ReportRunCard = {
  id: string;
  reportType: ReportTypeId;
  label: string;
  periodLabel: string;
  status: string;
  requestedAt: Date;
  finishedAt: Date | null;
  errorMessage: string | null;
  stats: {
    ledgerRows?: number;
    outputRows?: number;
    sourceFiles?: number;
    warnings?: string[];
    skipped?: { reason: string; count: number }[];
  } | null;
  sources: string[];
  artifacts: {
    id: string;
    filename: string;
    sizeBytes: number | null;
    driveUrl: string | null;
    driveStatus: string | null;
  }[];
};

const LABELS = new Map(REPORT_DEFINITIONS.map((definition) => [definition.id, definition.label]));

export async function listReportRuns(tenantId: string, limit = 50): Promise<ReportRunCard[]> {
  const db = getDb();

  const runs = await db
    .select()
    .from(schema.reportRuns)
    .where(eq(schema.reportRuns.tenantId, tenantId))
    .orderBy(desc(schema.reportRuns.createdAt))
    .limit(limit);

  if (runs.length === 0) return [];

  const ids = runs.map((run) => run.id);

  const [sources, artifacts] = await Promise.all([
    db
      .select({
        runId: schema.reportRunSources.reportRunId,
        filename: schema.sourceFiles.originalFilename,
      })
      .from(schema.reportRunSources)
      .innerJoin(
        schema.sourceFiles,
        eq(schema.sourceFiles.id, schema.reportRunSources.sourceFileId),
      )
      .where(inArray(schema.reportRunSources.reportRunId, ids)),

    db
      .select()
      .from(schema.reportArtifacts)
      .where(inArray(schema.reportArtifacts.reportRunId, ids)),
  ]);

  return runs.map((run) => ({
    id: run.id,
    reportType: run.reportType,
    label: LABELS.get(run.reportType) ?? run.reportType,
    periodLabel: run.periodLabel,
    status: run.status,
    requestedAt: run.createdAt,
    finishedAt: run.finishedAt,
    errorMessage: run.errorMessage,
    stats: run.stats as ReportRunCard["stats"],
    sources: sources
      .filter((source) => source.runId === run.id)
      .map((source) => source.filename)
      .sort(),
    artifacts: artifacts
      .filter((artifact) => artifact.reportRunId === run.id)
      .map((artifact) => ({
        id: artifact.id,
        filename: artifact.filename,
        sizeBytes: artifact.sizeBytes,
        driveUrl: artifact.driveUrl,
        driveStatus: artifact.driveStatus,
      }))
      .sort((a, b) => a.filename.localeCompare(b.filename)),
  }));
}

/**
 * Periods that can actually be built, per report type — a period with no parsed
 * uploads for that report would only ever produce an error.
 */
export async function availablePeriods(
  tenantId: string,
): Promise<Record<ReportTypeId, string[]>> {
  const rows = await getDb()
    .selectDistinct({
      dataset: schema.sourceFiles.dataset,
      periodLabel: schema.sourceFiles.periodLabel,
      granularity: schema.sourceFiles.periodGranularity,
    })
    .from(schema.sourceFiles)
    .where(
      and(eq(schema.sourceFiles.tenantId, tenantId), eq(schema.sourceFiles.status, "parsed")),
    );

  const result = {} as Record<ReportTypeId, string[]>;

  for (const definition of REPORT_DEFINITIONS) {
    const usable = rows.filter(
      (row) =>
        row.dataset !== null &&
        definition.datasets.includes(row.dataset) &&
        row.periodLabel !== null &&
        definition.granularity.includes(row.granularity ?? "month"),
    );

    const datasetsByPeriod = new Map<string, Set<string>>();

    for (const row of usable) {
      const period = row.periodLabel!;
      const seen = datasetsByPeriod.get(period) ?? new Set<string>();

      seen.add(row.dataset!);
      datasetsByPeriod.set(period, seen);
    }

    const periods = [...datasetsByPeriod.entries()]
      // A report needing every channel is not offered until every channel is
      // there. Offering it and then refusing wastes the operator's time, and
      // building it anyway would quietly under-report.
      .filter(([, datasets]) =>
        definition.requiresEveryDataset
          ? definition.datasets.every((dataset) => datasets.has(dataset))
          : true,
      )
      .map(([period]) => period);

    // Newest first: that is the period being worked on.
    result[definition.id] = periods.sort().reverse();
  }

  return result;
}
