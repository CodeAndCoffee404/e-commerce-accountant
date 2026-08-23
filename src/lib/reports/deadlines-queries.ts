import { and, desc, eq, inArray } from "drizzle-orm";

import type { PeriodGranularity } from "@/lib/db/schema";
import { getDb, schema } from "@/lib/db";

import {
  computeDeadline,
  compareDeadlineRows,
  deadlineState,
  normaliseDeadlineRule,
  type DeadlineRule,
  type DeadlineState,
} from "./deadlines";
import { REPORT_DEFINITIONS, type ReportTypeId } from "./definitions";
import { loadReportSettings } from "./queries";
import { preparedGranularities, type AllReportSettings } from "./settings";

/**
 * Reports a statutory deadline can be set for: the ones that go into a
 * filing. `custom_slice` is informational — built on demand, filed nowhere —
 * so it never gets a deadline row, on Settings or the dashboard alike.
 */
const DEADLINE_DEFINITIONS = REPORT_DEFINITIONS.filter((definition) => !definition.informational);

export type DeadlineRuleRow = {
  reportType: ReportTypeId;
  label: string;
  granularity: PeriodGranularity;
  rule: DeadlineRule;
};

/**
 * Every deadline rule this tenant can configure, one per (report,
 * periodicity) it actually prepares, with the strict default filled in for
 * anything never saved.
 */
export async function loadDeadlineRules(
  tenantId: string,
  preloadedSettings?: AllReportSettings,
): Promise<DeadlineRuleRow[]> {
  const settings = preloadedSettings ?? (await loadReportSettings(tenantId));

  const stored = await getDb()
    .select({
      reportType: schema.reportDeadlines.reportType,
      granularity: schema.reportDeadlines.granularity,
      deadlineDay: schema.reportDeadlines.deadlineDay,
      deadlineMonth: schema.reportDeadlines.deadlineMonth,
    })
    .from(schema.reportDeadlines)
    .where(eq(schema.reportDeadlines.tenantId, tenantId));

  const byKey = new Map(
    stored.map((row) => [
      `${row.reportType}:${row.granularity}`,
      { day: row.deadlineDay, month: row.deadlineMonth },
    ]),
  );

  const result: DeadlineRuleRow[] = [];

  for (const definition of DEADLINE_DEFINITIONS) {
    const configured = settings[definition.id];

    if (!configured.enabled) continue;

    for (const granularity of preparedGranularities(definition, configured)) {
      const raw = byKey.get(`${definition.id}:${granularity}`);

      result.push({
        reportType: definition.id,
        label: definition.label,
        granularity,
        rule: normaliseDeadlineRule(granularity, raw),
      });
    }
  }

  return result;
}

export type DeadlineDashboardRow = {
  key: string;
  reportType: ReportTypeId;
  label: string;
  granularity: PeriodGranularity;
  periodLabel: string;
  deadline: string;
  state: DeadlineState;
};

/**
 * The dashboard's Report deadlines block: one row per report the tenant
 * prepares, for that report's current reporting period — the last one that
 * has actually finished, see PLAN §8.
 *
 * A report with no completed period yet (the tenant opened the app before its
 * first month closed) is left out rather than shown with a nonsensical
 * period.
 */
export async function loadReportDeadlines(
  tenantId: string,
  preloadedSettings?: AllReportSettings,
): Promise<DeadlineDashboardRow[]> {
  const settings = preloadedSettings ?? (await loadReportSettings(tenantId));
  const rules = await loadDeadlineRules(tenantId, settings);

  if (rules.length === 0) return [];

  const today = new Date().toISOString().slice(0, 10);
  const granularities = [...new Set(rules.map((rule) => rule.granularity))];

  const periods = await getDb()
    .select({
      label: schema.periods.label,
      granularity: schema.periods.granularity,
      endDate: schema.periods.endDate,
    })
    .from(schema.periods)
    .where(
      and(eq(schema.periods.tenantId, tenantId), inArray(schema.periods.granularity, granularities)),
    )
    .orderBy(desc(schema.periods.startDate));

  // The last completed period per granularity: the most recent one whose end
  // date has already passed.
  const currentPeriod = new Map<PeriodGranularity, { label: string; end: string }>();

  for (const period of periods) {
    if (currentPeriod.has(period.granularity)) continue;
    if (period.endDate >= today) continue;

    currentPeriod.set(period.granularity, { label: period.label, end: period.endDate });
  }

  const periodLabels = [...new Set([...currentPeriod.values()].map((p) => p.label))];

  const runs =
    periodLabels.length === 0
      ? []
      : await getDb()
          .select({
            reportType: schema.reportRuns.reportType,
            periodLabel: schema.reportRuns.periodLabel,
            status: schema.reportRuns.status,
          })
          .from(schema.reportRuns)
          .where(
            and(
              eq(schema.reportRuns.tenantId, tenantId),
              inArray(schema.reportRuns.periodLabel, periodLabels),
              eq(schema.reportRuns.status, "succeeded"),
            ),
          );

  const completed = new Set(runs.map((run) => `${run.reportType}:${run.periodLabel}`));

  const rows: DeadlineDashboardRow[] = [];

  for (const rule of rules) {
    const period = currentPeriod.get(rule.granularity);

    if (!period) continue;

    const deadline = computeDeadline(rule.granularity, period.end, rule.rule);
    const isDone = completed.has(`${rule.reportType}:${period.label}`);

    rows.push({
      key: `${rule.reportType}:${rule.granularity}`,
      reportType: rule.reportType,
      label: rule.label,
      granularity: rule.granularity,
      periodLabel: period.label,
      deadline,
      state: deadlineState(deadline, today, isDone),
    });
  }

  return rows.sort(compareDeadlineRows);
}
