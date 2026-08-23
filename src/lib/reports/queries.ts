import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

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

/** The channels whose rules rows are report variants, e.g. custom reports. */
const VARIANT_CHANNELS = REPORT_DEFINITIONS.flatMap((definition) =>
  definition.variants ? [definition.variants.rulesChannel] : [],
);

/**
 * key → display name for every stored variant, so a run named by its variant
 * key shows the definition's name. A deleted definition falls back to the key;
 * the workbook filename still carries the name it was built under.
 */
async function loadVariantNames(tenantId: string): Promise<Map<string, string>> {
  if (VARIANT_CHANNELS.length === 0) return new Map();

  const rows = await getDb()
    .select({ key: schema.channelRules.key, value: schema.channelRules.value })
    .from(schema.channelRules)
    .where(
      and(
        eq(schema.channelRules.tenantId, tenantId),
        inArray(schema.channelRules.channel, VARIANT_CHANNELS),
      ),
    );

  return new Map(rows.map((row) => [row.key, variantDisplayName(row.value, row.key)]));
}

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
  const variantNames = runs.some((run) => run.variant !== null)
    ? await loadVariantNames(tenantId)
    : new Map<string, string>();

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
    label: run.variant
      ? variantNames.get(run.variant) ?? run.variant
      : LABELS.get(run.reportType) ?? run.reportType,
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

      // A reporting-start date narrows the checklist, not the data: the files
      // are still there, the period still exists, this report simply does not
      // ask for it any more.
      if (configured.effectiveFrom && period.start < configured.effectiveFrom) continue;

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
