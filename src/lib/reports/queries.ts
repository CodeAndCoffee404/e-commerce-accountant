import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { PeriodGranularity } from "@/lib/db/schema";

import { REPORT_DEFINITIONS, type ReportTypeId } from "./definitions";
import { resolveCoverage, uncoveredMonths } from "@/lib/periods/coverage";
import { DATASET_NAMES } from "@/modules/channels/registry";
import { variantDisplayName } from "@/modules/reports/registry";

import {
  defaultSettings,
  describeNeeds,
  normaliseSettings,
  preparedGranularities,
  requiredCountries,
  requiredDatasets,
  type AllReportSettings,
} from "./settings";

/** The channels whose rules rows are report variants, e.g. custom reports. */
const VARIANT_CHANNELS = REPORT_DEFINITIONS.flatMap((definition) =>
  definition.variants ? [definition.variants.rulesChannel] : [],
);

export type ReportAvailability = {
  /** False hides the card entirely; the report also refuses to build. */
  enabled: boolean;
  /** The "Needs" line, faithful to this tenant's configuration. */
  needs: string;
  /** Periods that can be built right now. */
  ready: string[];
  /**
   * Periods where something has been uploaded but the report cannot be built
   * yet. Newest first.
   *
   * `missing` names the pieces still wanted. `endsOn` is set instead when
   * nothing is missing and the period simply has not finished — a quarter
   * two months in is not a smaller quarter, and saying "waiting for files"
   * would send someone looking for exports that do not exist yet.
   */
  blocked: { period: string; missing: string[]; endsOn: string | null }[];
  /**
   * For reports built per tenant-defined variant: one entry per stored
   * definition, each becoming its own card. Absent for ordinary reports.
   */
  variants?: { key: string; name: string; summary: string }[];
};

/**
 * This tenant's report configuration, with the strict defaults filled in for
 * anything never saved. One row per report in channel_rules under the
 * "reports" channel — reference data rather than schema, because that is what
 * it is: the client's own description of how their reporting works.
 */
export async function loadReportSettings(tenantId: string): Promise<AllReportSettings> {
  const rows = await getDb()
    .select({ key: schema.channelRules.key, value: schema.channelRules.value })
    .from(schema.channelRules)
    .where(
      and(eq(schema.channelRules.tenantId, tenantId), eq(schema.channelRules.channel, "reports")),
    );

  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const result = defaultSettings();

  for (const definition of REPORT_DEFINITIONS) {
    if (stored.has(definition.id)) {
      result[definition.id] = normaliseSettings(definition, stored.get(definition.id));
    }
  }

  return result;
}

/**
 * What each report can be built for, and what is holding the rest back.
 *
 * Offering a period and then refusing it wastes the operator's time, so an
 * incomplete period is not offered. But refusing in silence is worse: a card
 * that greys itself out with no reason leaves someone re-uploading files that
 * are already there. So the two are returned together — what can be built, and
 * what each remaining period is still waiting for.
 */
export async function availablePeriods(
  tenantId: string,
  preloadedSettings?: AllReportSettings,
): Promise<Record<ReportTypeId, ReportAvailability>> {
  // The scheduler's day, in UTC, matching the cron. A period is offered only
  // once it is over: a quarter built from the two months that have happened
  // looks like a quarter and is not one.
  const today = new Date().toISOString().slice(0, 10);

  const [periods, files, settings, variantRows] = await Promise.all([
    getDb()
      .select({
        label: schema.periods.label,
        granularity: schema.periods.granularity,
        start: schema.periods.startDate,
        end: schema.periods.endDate,
      })
      .from(schema.periods)
      .where(eq(schema.periods.tenantId, tenantId))
      // By when they start, never by their label: '2026.Y' and '2026.Q3' sort
      // before '2026.07 July' as text, which would interleave a year with the
      // months inside it.
      .orderBy(desc(schema.periods.startDate)),

    getDb()
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
        and(eq(schema.sourceFiles.tenantId, tenantId), eq(schema.sourceFiles.status, "parsed")),
      ),
    // Callers that already hold the settings pass them in; the read happens
    // once per request, not once per helper.
    preloadedSettings ?? loadReportSettings(tenantId),
    VARIANT_CHANNELS.length === 0
      ? Promise.resolve([])
      : getDb()
          .select({
            channel: schema.channelRules.channel,
            key: schema.channelRules.key,
            value: schema.channelRules.value,
          })
          .from(schema.channelRules)
          .where(
            and(
              eq(schema.channelRules.tenantId, tenantId),
              inArray(schema.channelRules.channel, VARIANT_CHANNELS),
            ),
          ),
  ]);

  const result = {} as Record<ReportTypeId, ReportAvailability>;

  for (const definition of REPORT_DEFINITIONS) {
    const configured = settings[definition.id];

    if (!configured.enabled) {
      result[definition.id] = { enabled: false, needs: "", ready: [], blocked: [] };
      continue;
    }

    // What the module can build, narrowed by what this client files.
    const prepared = preparedGranularities(definition, configured);
    const candidates = files
      .filter(
        (file) =>
          file.dataset !== null &&
          definition.datasets.includes(file.dataset) &&
          file.periodStart !== null &&
          file.periodEnd !== null,
      )
      .map((file) => ({
        id: file.id,
        dataset: file.dataset!,
        countryCode: file.countryCode,
        periodStart: file.periodStart!,
        periodEnd: file.periodEnd!,
        granularity: file.granularity ?? ("month" as const),
      }));

    const ready: string[] = [];
    const blocked: ReportAvailability["blocked"] = [];

    for (const period of periods) {
      if (!prepared.includes(period.granularity)) continue;

      // A period that starts before the report's configured start date does
      // not exist for this report at all — not offered, not blocked, just
      // absent, exactly as if the report had not been enabled yet.
      if (configured.startsFrom && period.start < configured.startsFrom) continue;

      // Coarser files win over the months they already contain, so a channel
      // that ships both a quarterly export and its three monthly ones is
      // counted once rather than twice.
      const covered = resolveCoverage(period, candidates);

      // A period nothing has been uploaded for is not "blocked" — it is empty,
      // and listing every open month as blocked would bury the ones actually
      // waiting on something. The dashboard is where an empty month is shown.
      if (covered.length === 0) continue;

      const missing: string[] = [];

      // A report needing every channel is not offered until every required
      // channel is there for every month of the period: building it anyway
      // would quietly under-report by exactly the channels nobody noticed were
      // absent. For a month that is the old question asked the old way; for a
      // quarter it is the one that matters, since two months out of three look
      // like a whole quarter in every other respect.
      if (definition.requiresEveryDataset) {
        for (const dataset of requiredDatasets(definition, configured)) {
          const held = covered.filter((file) => file.dataset === dataset);

          if (uncoveredMonths(period, held).length > 0) missing.push(DATASET_NAMES[dataset]);
        }
      }

      // One dataset, ten marketplaces. Checked here as well as at build time,
      // so an incomplete month is never offered in the first place.
      if (definition.id === "amazon_zoho_invoice") {
        for (const country of requiredCountries(configured)) {
          const held = covered.filter((file) => file.countryCode === country);

          if (uncoveredMonths(period, held).length > 0) missing.push(country);
        }
      }

      if (missing.length > 0) blocked.push({ period: period.label, missing, endsOn: null });
      else if (period.end >= today) {
        blocked.push({ period: period.label, missing: [], endsOn: period.end });
      } else ready.push(period.label);
    }

    // Newest first, and already in that order: the periods were read sorted by
    // when they start.
    result[definition.id] = {
      enabled: true,
      needs: describeNeeds(definition, configured),
      ready,
      blocked,
      ...(definition.variants
        ? {
            variants: variantRows
              .filter((row) => row.channel === definition.variants!.rulesChannel)
              .map((row) => ({
                key: row.key,
                name: variantDisplayName(row.value, row.key),
                summary: definition.variants!.summarise(row.value),
              }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          }
        : {}),
    };
  }

  return result;
}

/**
 * Required channel rules a tenant does not have.
 *
 * Worth asking before a build rather than after one: a missing rule is not a
 * property of a period, it stops every period at once, and the fix is one
 * button on another page. Saying so up front beats letting someone select a
 * period and press Build to find out.
 *
 * Scoped to enabled reports and their required channels. An optional channel
 * with data still needs its rules, but that is caught at build time with the
 * same message — this banner is for what must be fixed before anything works.
 */
export async function missingChannelRules(
  tenantId: string,
  preloadedSettings?: AllReportSettings,
): Promise<string[]> {
  const [present, settings] = await Promise.all([
    getDb()
      .select({ channel: schema.channelRules.channel, key: schema.channelRules.key })
      .from(schema.channelRules)
      .where(eq(schema.channelRules.tenantId, tenantId)),
    preloadedSettings ?? loadReportSettings(tenantId),
  ]);

  const have = new Set(present.map((rule) => `${rule.channel}/${rule.key}`));
  const absent = new Set<string>();

  for (const definition of REPORT_DEFINITIONS) {
    const configured = settings[definition.id];

    if (!configured.enabled) continue;

    const required = new Set<string>(requiredDatasets(definition, configured));

    for (const rule of definition.requiredRules) {
      if (!required.has(rule.channel)) continue;
      if (!have.has(`${rule.channel}/${rule.key}`)) absent.add(`${rule.channel} / ${rule.key}`);
    }
  }

  return [...absent].sort();
}

export type ReportPeriodRow = {
  period: string;
  granularity: PeriodGranularity;
  state: "built" | "stale" | "ready" | "waiting" | "failed" | "running" | "queued";
  /** Set only in the "waiting" state: what is still missing for this period. */
  missing: string[];
  /** Set instead of `missing` when nothing is missing — the period just hasn't ended yet. */
  endsOn: string | null;
  builtAt: Date | null;
  outputRows: number | null;
  errorMessage: string | null;
  artifact: { id: string; filename: string } | null;
};

/**
 * Every period a report has ever touched, one row each: built, stale, ready
 * to build, waiting on a file, failed, or mid-run — computed for every
 * enabled report at once, since the Reports screen shows one report at a
 * time but a person switches between them without a round trip.
 *
 * `ready`/`blocked` from `availablePeriods` say what *can* build; this adds
 * what already *has* — the latest run per (report, period), its artifact,
 * and whether a source file was replaced since it succeeded.
 */
export async function allReportPeriodRows(
  tenantId: string,
  availability: Record<ReportTypeId, ReportAvailability>,
): Promise<Record<ReportTypeId, ReportPeriodRow[]>> {
  const db = getDb();

  const [allPeriods, runs] = await Promise.all([
    db
      .select({
        label: schema.periods.label,
        granularity: schema.periods.granularity,
        start: schema.periods.startDate,
      })
      .from(schema.periods)
      .where(eq(schema.periods.tenantId, tenantId))
      .orderBy(desc(schema.periods.startDate)),

    db
      .select({
        id: schema.reportRuns.id,
        reportType: schema.reportRuns.reportType,
        periodLabel: schema.reportRuns.periodLabel,
        status: schema.reportRuns.status,
        createdAt: schema.reportRuns.createdAt,
        finishedAt: schema.reportRuns.finishedAt,
        errorMessage: schema.reportRuns.errorMessage,
        stats: schema.reportRuns.stats,
      })
      .from(schema.reportRuns)
      .where(eq(schema.reportRuns.tenantId, tenantId))
      .orderBy(desc(schema.reportRuns.createdAt)),
  ]);

  // Latest run per (report type, period) — runs arrive newest first, so the
  // first one seen for a key is the one that matters.
  const latestByKey = new Map<string, (typeof runs)[number]>();

  for (const run of runs) {
    const key = `${run.reportType}|${run.periodLabel}`;

    if (!latestByKey.has(key)) latestByKey.set(key, run);
  }

  const latestIds = [...latestByKey.values()].map((run) => run.id);

  const [artifacts, sources] = await Promise.all([
    latestIds.length
      ? db
          .select({
            runId: schema.reportArtifacts.reportRunId,
            id: schema.reportArtifacts.id,
            filename: schema.reportArtifacts.filename,
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

  const periodStart = new Map(allPeriods.map((period) => [period.label, period.start]));
  const periodGranularity = new Map(allPeriods.map((period) => [period.label, period.granularity]));

  const result = {} as Record<ReportTypeId, ReportPeriodRow[]>;

  for (const definition of REPORT_DEFINITIONS) {
    const avail = availability[definition.id];

    if (!avail?.enabled) {
      result[definition.id] = [];
      continue;
    }

    const readySet = new Set(avail.ready);
    const blockedMap = new Map(avail.blocked.map((entry) => [entry.period, entry]));

    const labels = new Set<string>([...avail.ready, ...blockedMap.keys()]);

    for (const run of runs) {
      if (run.reportType === definition.id) labels.add(run.periodLabel);
    }

    const rows: ReportPeriodRow[] = [...labels].map((label) => {
      const latest = latestByKey.get(`${definition.id}|${label}`);
      const runArtifact = latest ? (artifacts.find((a) => a.runId === latest.id) ?? null) : null;
      const stale =
        !!latest &&
        latest.status === "succeeded" &&
        sources.some((s) => s.runId === latest.id && s.status === "superseded");

      const state: ReportPeriodRow["state"] =
        latest?.status === "succeeded"
          ? stale
            ? "stale"
            : "built"
          : latest?.status === "failed"
            ? "failed"
            : latest?.status === "running" || latest?.status === "queued"
              ? latest.status
              : readySet.has(label)
                ? "ready"
                : "waiting";

      const blocked = blockedMap.get(label);
      const stats = (latest?.stats ?? {}) as { outputRows?: number };

      return {
        period: label,
        granularity: periodGranularity.get(label) ?? "month",
        state,
        missing: state === "waiting" ? (blocked?.missing ?? []) : [],
        endsOn: state === "waiting" ? (blocked?.endsOn ?? null) : null,
        builtAt: latest?.status === "succeeded" ? latest.finishedAt : null,
        outputRows: stats.outputRows ?? null,
        errorMessage: latest?.status === "failed" ? latest.errorMessage : null,
        artifact: runArtifact ? { id: runArtifact.id, filename: runArtifact.filename } : null,
      };
    });

    rows.sort((a, b) => (periodStart.get(b.period) ?? "").localeCompare(periodStart.get(a.period) ?? ""));

    result[definition.id] = rows;
  }

  return result;
}
