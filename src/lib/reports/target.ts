import type { ReportTypeId } from "@/lib/reports/definitions";

/**
 * One (report, period) a build is requested for — the unit the build queue
 * moves in, and the way the screens name a build while it is in flight.
 *
 * It lives here rather than beside the queue because it is a naming rule, not
 * a piece of the interface: the dashboard's progress count reaches for it too,
 * and a count that spelled a report's name differently from the queue would
 * quietly never match one.
 */
export type Target = {
  reportType: ReportTypeId;
  periodLabel: string;
  variant?: string;
  label: string;
};

export const targetKey = (target: Target) =>
  `${target.reportType}:${target.variant ?? ""}|${target.periodLabel}`;

/** The same name for one of a month's reports, which is all the dashboard has. */
export const reportKey = (reportType: ReportTypeId, month: string) =>
  targetKey({ reportType, periodLabel: month, label: "" });
