import { and, eq, inArray } from "drizzle-orm";

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
 * filing. An informational report never gets a deadline row, on Settings or
 * the dashboard alike.
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
 * The dashboard's Report deadlines block: everything due for the month
 * selected on the dashboard, not a fixed "current period" of its own.
 *
 * A monthly report always gets a row, for that month. A quarterly or yearly
 * report only gets one when the selected month is the last month of its
 * quarter or year — April is not the end of anything, so a quarterly report
 * has nothing to say about it. That is what keeps the block honest about
 * "todo for this month" rather than mixing in periods the tenant is not
 * currently closing.
 */
export async function loadReportDeadlines(
  tenantId: string,
  month: string,
  preloadedSettings?: AllReportSettings,
): Promise<DeadlineDashboardRow[]> {
  const settings = preloadedSettings ?? (await loadReportSettings(tenantId));
  const rules = await loadDeadlineRules(tenantId, settings);

  if (rules.length === 0) return [];

  const today = new Date().toISOString().slice(0, 10);

  const periods = await getDb()
    .select({
      label: schema.periods.label,
      granularity: schema.periods.granularity,
      startDate: schema.periods.startDate,
      endDate: schema.periods.endDate,
    })
    .from(schema.periods)
    .where(eq(schema.periods.tenantId, tenantId));

  const monthPeriod = periods.find((p) => p.granularity === "month" && p.label === month);

  if (!monthPeriod) return [];

  // The quarter/year containing this month, only kept when this month is the
  // last one in it — otherwise that report has nothing due this month.
  const containing = (granularity: PeriodGranularity) =>
    periods.find(
      (p) =>
        p.granularity === granularity &&
        p.startDate <= monthPeriod.startDate &&
        p.endDate === monthPeriod.endDate,
    );

  const periodByGranularity: Partial<Record<PeriodGranularity, { label: string; end: string }>> = {
    month: { label: monthPeriod.label, end: monthPeriod.endDate },
  };

  const quarter = containing("quarter");
  if (quarter) periodByGranularity.quarter = { label: quarter.label, end: quarter.endDate };

  const year = containing("year");
  if (year) periodByGranularity.year = { label: year.label, end: year.endDate };

  const relevantLabels = [...new Set(Object.values(periodByGranularity).map((p) => p!.label))];

  const runs = await getDb()
    .select({
      reportType: schema.reportRuns.reportType,
      periodLabel: schema.reportRuns.periodLabel,
      status: schema.reportRuns.status,
    })
    .from(schema.reportRuns)
    .where(
      and(
        eq(schema.reportRuns.tenantId, tenantId),
        inArray(schema.reportRuns.periodLabel, relevantLabels),
        eq(schema.reportRuns.status, "succeeded"),
      ),
    );

  const completed = new Set(runs.map((run) => `${run.reportType}:${run.periodLabel}`));

  const rows: DeadlineDashboardRow[] = [];

  for (const rule of rules) {
    const period = periodByGranularity[rule.granularity];

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
