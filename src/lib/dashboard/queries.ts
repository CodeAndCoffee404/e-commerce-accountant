import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { log } from "@/lib/log";
import { ensurePeriods } from "@/lib/periods/ensure";
import { amazonMonthlyLabel, type AmazonCountry } from "@/lib/ingest/datasets";
import { REPORT_DEFINITIONS, type ReportTypeId } from "@/lib/reports/definitions";
import { availablePeriods, loadReportSettings } from "@/lib/reports/queries";
import { requiredCountries, requiredDatasets } from "@/lib/reports/settings";
import { DATASET_NAMES } from "@/modules/channels/registry";
import { ZOHO_COUNTRIES } from "@/modules/reports/amazon-zoho-invoice";

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
  /**
   * The workbook the latest successful run produced, for the row's own
   * download and "open in Drive" buttons. `driveUrl` is null until the file
   * reaches Drive — or forever, if Drive was never connected.
   */
  artifact: { id: string; filename: string; driveUrl: string | null } | null;
  /**
   * The run that produced it, which is what a re-send to Drive is keyed on —
   * `republish` works per run, not per file.
   */
  runId: string | null;
  drive: { synced: number; failed: number; pending: number; total: number };
};

/** A cell of the history matrix: the thing arrived, did not, or was never required. */
export type MatrixCell = "yes" | "no" | "optional";

/**
 * One labelled band of the history matrix. Source files and reports are the
 * two halves of a month and read as one grid, but they are counted differently
 * — a dot is a file that arrived in one and a run that succeeded in the other —
 * so each keeps its own header rather than being flattened into one list.
 */
export type MatrixGroup = {
  key: string;
  label: string;
  kind: "upload" | "report";
  rows: { key: string; label: string; cells: MatrixCell[] }[];
};

export type DashboardData = {
  /** Months with any parsed upload, newest first. */
  months: string[];
  month: string | null;
  items: ChecklistItem[];
  reports: CloseReport[];
  /** Reports the one-button build would run right now. */
  buildable: number;
  /**
   * The month this company is currently working — the last one that has
   * finished, not the calendar month we are standing in. Through August the
   * accountant is closing July; August is not closable until it ends.
   *
   * The same month the screen opens on, so the shortcut in the period bar
   * always lands where the dashboard started.
   */
  currentMonth: string | null;
  matrix: {
    months: string[];
    groups: MatrixGroup[];
  };
};

/**
 * Everything the month-close screen shows, assembled in one pass.
 *
 * The checklist is derived from the enabled reports' own requirements rather
 * than hard-coded, so switching a channel to optional or a report off on
 * Settings changes this page the same moment it changes the builds.
 */
export async function loadDashboard(
  tenantId: string,
  requestedMonth?: string,
): Promise<DashboardData> {
  const db = getDb();

  // The second way a period comes into being, and the one that does not
  // depend on a scheduler. Vercel's plan allows a single cron and fires it
  // within an hour of its slot; if that run is missed the month would
  // otherwise stay invisible until the next one. Opening periods is
  // idempotent, so doing it here costs a query that finds nothing on all but
  // one day a month.
  //
  // Never allowed to fail the page: a checklist that will not render because
  // a period could not be opened is a worse answer than one that renders
  // without the newest period on it.
  try {
    await ensurePeriods(tenantId, new Date().toISOString().slice(0, 10));
  } catch (error) {
    log.error("period.ensure_failed", error, { tenantId });
  }

  const settings = await loadReportSettings(tenantId);
  const today = new Date().toISOString().slice(0, 10);
  const [openPeriods, files, availability] = await Promise.all([
    db
      .select({
        label: schema.periods.label,
        granularity: schema.periods.granularity,
        startDate: schema.periods.startDate,
        endDate: schema.periods.endDate,
      })
      .from(schema.periods)
      .where(eq(schema.periods.tenantId, tenantId))
      // By when they start, never by their label: '2026.Y' sorts before
      // '2026.07 July' as text.
      .orderBy(desc(schema.periods.startDate)),
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
    availablePeriods(tenantId, settings),
  ]);

  const monthly = files.filter((file) => (file.granularity ?? "month") === "month");

  // Months come from the period table now, so one nobody has uploaded for
  // still appears — which is the point of opening periods ahead of their data.
  const months = openPeriods
    .filter((period) => period.granularity === "month")
    .map((period) => period.label);

  // The month being closed, which is what "current" means here — see
  // `defaultMonth`. Held in a name because the period bar reports it too, and
  // the shortcut back to it must land on the month the screen opened on.
  const reportingMonth = defaultMonth(openPeriods, today) ?? months[0] ?? null;
  const month =
    requestedMonth && months.includes(requestedMonth) ? requestedMonth : reportingMonth;

  // The chosen month's own start date, compared against a report's
  // `startsFrom` — never the label, which sorts and compares nothing like a
  // date ('2026.05 May' vs '2026-06-01').
  const monthStart = month ? openPeriods.find((period) => period.label === month)?.startDate ?? null : null;

  // What the month needs, from the enabled reports' own definitions.
  const items: ChecklistItem[] = [];

  for (const definition of REPORT_DEFINITIONS) {
    const configured = settings[definition.id];

    // Informational reports are built on demand and file nothing, so they
    // neither add checklist items nor hold the month open.
    if (!configured.enabled || definition.informational) continue;

    // A report that does not exist yet for this month asks nothing of it —
    // its datasets are not "required" here until its start date arrives.
    if (configured.startsFrom && monthStart && monthStart < configured.startsFrom) continue;

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

  const reports = month
    ? await loadReports(tenantId, month, monthStart, availability, settings)
    : [];

  // History: the checklist across every month on record, and beside it the
  // same months' reports. Two bands rather than one list — a dot means a file
  // arrived in the first and a run succeeded in the second.
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

  // One query for the whole band: every run that succeeded in any month on
  // show, which is all the report half of the grid needs to know.
  const matrixRuns = matrixMonths.length
    ? await db
        .select({
          reportType: schema.reportRuns.reportType,
          periodLabel: schema.reportRuns.periodLabel,
        })
        .from(schema.reportRuns)
        .where(
          and(
            eq(schema.reportRuns.tenantId, tenantId),
            eq(schema.reportRuns.status, "succeeded"),
            inArray(schema.reportRuns.periodLabel, matrixMonths),
          ),
        )
    : [];

  const builtByMonth = new Set(matrixRuns.map((run) => `${run.periodLabel}|${run.reportType}`));

  const reportRows = REPORT_DEFINITIONS.filter(
    (definition) => settings[definition.id].enabled && !definition.informational,
  ).map((definition) => ({
    key: definition.id,
    label: definition.label,
    cells: matrixMonths.map((candidate): MatrixCell =>
      builtByMonth.has(`${candidate}|${definition.id}`) ? "yes" : "no",
    ),
  }));

  const matrix = {
    months: matrixMonths,
    groups: [
      {
        key: "uploads",
        label: "Source files",
        kind: "upload" as const,
        rows: items.map((item) => ({
          key: item.key,
          label: item.label,
          cells: matrixMonths.map((candidate): MatrixCell => {
            if (uploadedByMonth.has(`${candidate}|${item.key}`)) return "yes";

            return item.requirement === "optional" ? "optional" : "no";
          }),
        })),
      },
      { key: "reports", label: "Reports", kind: "report" as const, rows: reportRows },
    ],
  };

  return {
    months,
    month,
    items,
    reports,
    buildable: reports.filter((report) => report.state === "ready" || report.stale).length,
    currentMonth: reportingMonth,
    matrix,
  };
}

/**
 * The month the screen opens on: the last one that has actually finished.
 *
 * On the first of August the August period exists, but nobody is working on
 * August — they are closing July, and its files are only now arriving. Opening
 * on the newest period would put an empty checklist in front of someone whose
 * work is one row further down.
 */
function defaultMonth(
  periods: { label: string; granularity: string; endDate: string }[],
  today: string,
): string | null {
  const finished = periods.find(
    (period) => period.granularity === "month" && period.endDate < today,
  );

  return finished?.label ?? null;
}

async function loadReports(
  tenantId: string,
  month: string,
  /** The month's own start date (ISO), for comparing against `startsFrom`. */
  monthStart: string | null,
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
            id: schema.reportArtifacts.id,
            filename: schema.reportArtifacts.filename,
            driveUrl: schema.reportArtifacts.driveUrl,
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
    const configured = settings[definition.id];

    if (!available?.enabled || definition.informational) continue;

    // Absent from this month's close the same way it is absent from Reports:
    // a period before the report's start date is not this report's business.
    if (configured.startsFrom && monthStart && monthStart < configured.startsFrom) continue;

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
      runId: succeeded ? latest!.id : null,
      // One workbook per run in practice; the first is the one to offer.
      artifact:
        succeeded && runArtifacts[0]
          ? {
              id: runArtifacts[0].id,
              filename: runArtifacts[0].filename,
              driveUrl: runArtifacts[0].driveUrl,
            }
          : null,
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
