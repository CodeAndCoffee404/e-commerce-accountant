import Decimal from "decimal.js";
import { and, desc, eq, inArray, sql, sum } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { amazonMonthlyLabel, type AmazonCountry } from "@/lib/ingest/datasets";
import { REPORT_DEFINITIONS, type ReportTypeId } from "@/lib/reports/definitions";
import { availablePeriods, loadReportSettings } from "@/lib/reports/queries";
import { DATASET_NAMES, requiredCountries, requiredDatasets } from "@/lib/reports/settings";
import { ZOHO_COUNTRIES } from "@/lib/reports/zoho-invoice";

import { previousMonthLabel } from "./period";

/** One thing the month needs: a file, either present or still wanted. */
export type ChecklistItem = {
  key: string;
  label: string;
  /** Optional never blocks a build; it is shown so its arrival is noticed. */
  requirement: "required" | "optional";
  uploaded: boolean;
  filename: string | null;
  rows: number | null;
};

export type CloseReport = {
  id: ReportTypeId;
  label: string;
  /**
   * built — the latest run for this month succeeded; ready — buildable now;
   * waiting — something is missing, named in `missing`.
   */
  state: "built" | "ready" | "waiting";
  missing: string[];
  /** Set when the latest run for the month failed, whatever the state. */
  lastFailure: string | null;
  warnings: number;
  builtAt: Date | null;
  /**
   * A run whose sources have since been replaced by a re-upload. The workbook
   * still exists and still traces, but it no longer reflects the ledger.
   */
  stale: boolean;
  drive: { synced: number; failed: number; pending: number; total: number };
};

export type DeltaRow = {
  channel: string;
  country: string | null;
  currency: string;
  /** Display-ready, two decimal places. Formatted here so the page stays lean. */
  current: string;
  previous: string;
  /** Null when there is no previous figure — the row is new this month. */
  changePct: number | null;
  flagged: boolean;
};

export type CloseData = {
  /** Months with any parsed upload, newest first. */
  months: string[];
  month: string | null;
  previousMonth: string | null;
  items: ChecklistItem[];
  reports: CloseReport[];
  /** Reports the one-button build would run right now. */
  buildable: number;
  deltas: DeltaRow[];
  matrix: {
    months: string[];
    rows: { key: string; label: string; cells: ("yes" | "no" | "optional")[] }[];
  };
};

/**
 * Everything the month-close screen shows, assembled in one pass.
 *
 * The checklist is derived from the enabled reports' own requirements rather
 * than hard-coded, so switching a channel to optional or a report off on
 * Settings changes this page the same moment it changes the builds.
 */
export async function loadClose(tenantId: string, requestedMonth?: string): Promise<CloseData> {
  const db = getDb();

  const [files, settings, availability] = await Promise.all([
    db
      .select({
        dataset: schema.sourceFiles.dataset,
        country: schema.sourceFiles.countryCode,
        period: schema.sourceFiles.periodLabel,
        granularity: schema.sourceFiles.periodGranularity,
        filename: schema.sourceFiles.originalFilename,
        detectionMeta: schema.sourceFiles.detectionMeta,
        uploadedAt: schema.sourceFiles.uploadedAt,
      })
      .from(schema.sourceFiles)
      .where(
        and(eq(schema.sourceFiles.tenantId, tenantId), eq(schema.sourceFiles.status, "parsed")),
      ),
    loadReportSettings(tenantId),
    availablePeriods(tenantId),
  ]);

  const monthly = files.filter((file) => (file.granularity ?? "month") === "month");
  const months = [...new Set(monthly.map((file) => file.period).filter(Boolean))] as string[];

  months.sort().reverse();

  const month = requestedMonth && months.includes(requestedMonth) ? requestedMonth : months[0] ?? null;
  const previousMonth = month ? previousMonthLabel(month) : null;

  // What the month needs, from the enabled reports' own definitions.
  const items: ChecklistItem[] = [];

  for (const definition of REPORT_DEFINITIONS) {
    const configured = settings[definition.id];

    if (!configured.enabled) continue;

    if (definition.id === "amazon_zoho_invoice") {
      const required = new Set(requiredCountries(configured));

      for (const country of ZOHO_COUNTRIES) {
        items.push({
          key: `amazon_monthly:${country}`,
          label: amazonMonthlyLabel(country as AmazonCountry),
          requirement: required.has(country) ? "required" : "optional",
          uploaded: false,
          filename: null,
          rows: null,
        });
      }
      continue;
    }

    const required = new Set(requiredDatasets(definition, configured));

    for (const dataset of definition.datasets) {
      if (items.some((item) => item.key === dataset)) continue;

      items.push({
        key: dataset,
        label: DATASET_NAMES[dataset],
        // A single-dataset report cannot build without its one file, whatever
        // requiresEveryDataset says.
        requirement:
          required.has(dataset) || definition.datasets.length === 1 ? "required" : "optional",
        uploaded: false,
        filename: null,
        rows: null,
      });
    }
  }

  if (month) {
    for (const file of monthly) {
      if (file.period !== month || !file.dataset) continue;

      const key =
        file.dataset === "amazon_monthly" ? `amazon_monthly:${file.country}` : file.dataset;
      const item = items.find((candidate) => candidate.key === key);

      if (!item) continue;

      const meta = (file.detectionMeta ?? {}) as { mappedRows?: number; rowCount?: number };

      item.uploaded = true;
      item.filename = file.filename;
      item.rows = meta.mappedRows ?? meta.rowCount ?? null;
    }
  }

  const [reports, deltas] = await Promise.all([
    month ? loadReports(tenantId, month, availability, settings) : Promise.resolve([]),
    month ? loadDeltas(tenantId, month, previousMonth) : Promise.resolve([]),
  ]);

  // History: the same checklist across every month on record.
  const matrixMonths = months.slice(0, 13);
  const uploadedByMonth = new Set(
    monthly
      .filter((file) => file.dataset)
      .map(
        (file) =>
          `${file.period}|${
            file.dataset === "amazon_monthly" ? `amazon_monthly:${file.country}` : file.dataset
          }`,
      ),
  );

  const matrix = {
    months: matrixMonths,
    rows: items.map((item) => ({
      key: item.key,
      label: item.label,
      cells: matrixMonths.map((candidate): "yes" | "no" | "optional" => {
        if (uploadedByMonth.has(`${candidate}|${item.key}`)) return "yes";

        return item.requirement === "optional" ? "optional" : "no";
      }),
    })),
  };

  return {
    months,
    month,
    previousMonth,
    items,
    reports,
    buildable: reports.filter((report) => report.state === "ready" || report.stale).length,
    deltas,
    matrix,
  };
}

async function loadReports(
  tenantId: string,
  month: string,
  availability: Awaited<ReturnType<typeof availablePeriods>>,
  settings: Awaited<ReturnType<typeof loadReportSettings>>,
): Promise<CloseReport[]> {
  const db = getDb();

  const runs = await db
    .select({
      id: schema.reportRuns.id,
      reportType: schema.reportRuns.reportType,
      status: schema.reportRuns.status,
      finishedAt: schema.reportRuns.finishedAt,
      errorMessage: schema.reportRuns.errorMessage,
      stats: schema.reportRuns.stats,
    })
    .from(schema.reportRuns)
    .where(
      and(eq(schema.reportRuns.tenantId, tenantId), eq(schema.reportRuns.periodLabel, month)),
    )
    .orderBy(desc(schema.reportRuns.createdAt));

  const latestByType = new Map<string, (typeof runs)[number]>();

  for (const run of runs) {
    if (!latestByType.has(run.reportType)) latestByType.set(run.reportType, run);
  }

  const latestIds = [...latestByType.values()].map((run) => run.id);

  const [artifacts, sources] = await Promise.all([
    latestIds.length
      ? db
          .select({
            runId: schema.reportArtifacts.reportRunId,
            driveStatus: schema.reportArtifacts.driveStatus,
          })
          .from(schema.reportArtifacts)
          .where(inArray(schema.reportArtifacts.reportRunId, latestIds))
      : Promise.resolve([]),
    latestIds.length
      ? db
          .select({
            runId: schema.reportRunSources.reportRunId,
            status: schema.sourceFiles.status,
          })
          .from(schema.reportRunSources)
          .innerJoin(
            schema.sourceFiles,
            eq(schema.sourceFiles.id, schema.reportRunSources.sourceFileId),
          )
          .where(inArray(schema.reportRunSources.reportRunId, latestIds))
      : Promise.resolve([]),
  ]);

  const result: CloseReport[] = [];

  for (const definition of REPORT_DEFINITIONS) {
    const available = availability[definition.id];

    if (!available?.enabled) continue;

    const latest = latestByType.get(definition.id);
    const succeeded = latest?.status === "succeeded";
    const runArtifacts = latest ? artifacts.filter((a) => a.runId === latest.id) : [];
    // A source replaced after the build means the workbook no longer reflects
    // the ledger. Said out loud, because nothing else would say it.
    const stale =
      succeeded && sources.some((s) => s.runId === latest!.id && s.status === "superseded");

    const blockedEntry = available.blocked.find((entry) => entry.period === month);
    const ready = available.ready.includes(month);

    // With nothing uploaded at all, availability has no entry for the month —
    // but "missing: everything" is useless. Name the pieces.
    const configured = settings[definition.id];
    const wholeList =
      definition.id === "amazon_zoho_invoice"
        ? requiredCountries(configured)
        : definition.requiresEveryDataset
          ? requiredDatasets(definition, configured).map((dataset) => DATASET_NAMES[dataset])
          : definition.datasets.map((dataset) => DATASET_NAMES[dataset]);

    const stats = (latest?.stats ?? {}) as { warnings?: string[] };

    result.push({
      id: definition.id,
      label: definition.label,
      state: succeeded ? "built" : ready ? "ready" : "waiting",
      missing: ready || succeeded ? [] : blockedEntry?.missing ?? wholeList,
      lastFailure: latest && latest.status === "failed" ? latest.errorMessage : null,
      warnings: stats.warnings?.length ?? 0,
      builtAt: succeeded ? latest!.finishedAt : null,
      stale,
      drive: {
        synced: runArtifacts.filter((a) => a.driveStatus === "synced").length,
        failed: runArtifacts.filter((a) => a.driveStatus === "failed").length,
        pending: runArtifacts.filter((a) => a.driveStatus === "pending" || a.driveStatus === null)
          .length,
        total: runArtifacts.length,
      },
    });
  }

  return result;
}

async function loadDeltas(
  tenantId: string,
  month: string,
  previousMonth: string | null,
): Promise<DeltaRow[]> {
  if (!previousMonth) return [];

  const rows = await getDb()
    .select({
      dataset: schema.transactions.dataset,
      country: schema.transactions.countryCode,
      currency: schema.transactions.currency,
      period: schema.transactions.periodLabel,
      gross: sum(schema.transactions.gross),
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.tenantId, tenantId),
        eq(schema.transactions.isCurrent, true),
        sql`${schema.transactions.periodLabel} in (${month}, ${previousMonth})`,
      ),
    )
    .groupBy(
      schema.transactions.dataset,
      schema.transactions.countryCode,
      schema.transactions.currency,
      schema.transactions.periodLabel,
    );

  return computeDeltas(
    rows.map((row) => ({
      dataset: row.dataset,
      country: row.country,
      currency: row.currency ?? "",
      period: row.period,
      gross: row.gross ?? "0",
    })),
    month,
    previousMonth,
  );
}

/**
 * Month-over-month comparison, flagged where a person should look.
 *
 * A flag is a swing of at least a quarter in either direction, or a channel
 * that went completely quiet — on amounts big enough to matter. It is a
 * pointer, not a verdict: the number may be perfectly right, but it should be
 * right on purpose.
 */
export function computeDeltas(
  rows: readonly {
    dataset: string;
    country: string | null;
    currency: string;
    period: string;
    gross: string;
  }[],
  month: string,
  previousMonth: string,
): DeltaRow[] {
  // A previous month with no data at all is not a comparison, it is the start
  // of the record: every row would come out "new" and the table would be pure
  // noise. The page says "nothing to compare" instead.
  if (!rows.some((row) => row.period === previousMonth)) return [];

  const buckets = new Map<string, { current: Decimal; previous: Decimal; row: (typeof rows)[number] }>();

  for (const row of rows) {
    if (!row.currency) continue;

    const key = `${row.dataset}|${row.country ?? ""}|${row.currency}`;
    const bucket = buckets.get(key) ?? {
      current: new Decimal(0),
      previous: new Decimal(0),
      row,
    };

    if (row.period === month) bucket.current = bucket.current.plus(row.gross);
    if (row.period === previousMonth) bucket.previous = bucket.previous.plus(row.gross);
    buckets.set(key, bucket);
  }

  const result: DeltaRow[] = [];

  for (const { current, previous, row } of buckets.values()) {
    if (current.isZero() && previous.isZero()) continue;

    const changePct = previous.isZero()
      ? null
      : Number(current.minus(previous).dividedBy(previous.abs()).times(100).toFixed(1));

    // Small numbers swing wildly and mean nothing; a hundred in any currency
    // here is a deliberate floor, not a tuned one.
    const material = Decimal.max(current.abs(), previous.abs()).greaterThanOrEqualTo(100);
    const flagged =
      material &&
      changePct !== null &&
      (Math.abs(changePct) >= 25 || (current.isZero() && !previous.isZero()));

    result.push({
      channel: DATASET_NAMES[row.dataset as keyof typeof DATASET_NAMES] ?? row.dataset,
      country: row.country,
      currency: row.currency,
      current: current.toFixed(2),
      previous: previous.toFixed(2),
      changePct,
      flagged,
    });
  }

  // The rows worth a look come first; the rest sort by channel and country.
  return result.sort((a, b) => {
    if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;

    return (
      a.channel.localeCompare(b.channel) ||
      (a.country ?? "").localeCompare(b.country ?? "") ||
      a.currency.localeCompare(b.currency)
    );
  });
}
