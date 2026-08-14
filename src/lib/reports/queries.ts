import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

import { REPORT_DEFINITIONS, type ReportTypeId } from "./definitions";
import { DATASET_NAMES } from "@/modules/channels/registry";

import {
  defaultSettings,
  describeNeeds,
  normaliseSettings,
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

export type ReportAvailability = {
  /** False hides the card entirely; the report also refuses to build. */
  enabled: boolean;
  /** The "Needs" line, faithful to this tenant's configuration. */
  needs: string;
  /** Periods that can be built right now. */
  ready: string[];
  /**
   * Periods where something has been uploaded but not enough, with the pieces
   * still wanted. Newest first.
   */
  blocked: { period: string; missing: string[] }[];
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
  const [rows, settings] = await Promise.all([
    getDb()
      .selectDistinct({
        dataset: schema.sourceFiles.dataset,
        periodLabel: schema.sourceFiles.periodLabel,
        granularity: schema.sourceFiles.periodGranularity,
        countryCode: schema.sourceFiles.countryCode,
      })
      .from(schema.sourceFiles)
      .where(
        and(eq(schema.sourceFiles.tenantId, tenantId), eq(schema.sourceFiles.status, "parsed")),
      ),
    // Callers that already hold the settings pass them in; the read happens
    // once per request, not once per helper.
    preloadedSettings ?? loadReportSettings(tenantId),
  ]);

  const result = {} as Record<ReportTypeId, ReportAvailability>;

  for (const definition of REPORT_DEFINITIONS) {
    const configured = settings[definition.id];

    if (!configured.enabled) {
      result[definition.id] = { enabled: false, needs: "", ready: [], blocked: [] };
      continue;
    }

    const usable = rows.filter(
      (row) =>
        row.dataset !== null &&
        definition.datasets.includes(row.dataset) &&
        row.periodLabel !== null &&
        definition.granularity.includes(row.granularity ?? "month"),
    );

    const byPeriod = new Map<string, { datasets: Set<string>; countries: Set<string> }>();

    for (const row of usable) {
      const period = row.periodLabel!;
      const entry = byPeriod.get(period) ?? { datasets: new Set(), countries: new Set() };

      entry.datasets.add(row.dataset!);
      if (row.countryCode) entry.countries.add(row.countryCode);
      byPeriod.set(period, entry);
    }

    const ready: string[] = [];
    const blocked: { period: string; missing: string[] }[] = [];

    for (const [period, entry] of byPeriod) {
      const missing: string[] = [];

      // A report needing every channel is not offered until every required
      // channel is there: building it anyway would quietly under-report by
      // exactly the channels nobody noticed were absent. Optional channels
      // never block — they are included whenever their data exists.
      if (definition.requiresEveryDataset) {
        for (const dataset of requiredDatasets(definition, configured)) {
          if (!entry.datasets.has(dataset)) missing.push(DATASET_NAMES[dataset]);
        }
      }

      // One dataset, ten marketplaces. Checked here as well as at build time,
      // so an incomplete month is never offered in the first place.
      if (definition.id === "amazon_zoho_invoice") {
        for (const country of requiredCountries(configured)) {
          if (!entry.countries.has(country)) missing.push(country);
        }
      }

      if (missing.length === 0) ready.push(period);
      else blocked.push({ period, missing });
    }

    // Newest first: that is the period being worked on.
    result[definition.id] = {
      enabled: true,
      needs: describeNeeds(definition, configured),
      ready: ready.sort().reverse(),
      blocked: blocked.sort((a, b) => b.period.localeCompare(a.period)),
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
