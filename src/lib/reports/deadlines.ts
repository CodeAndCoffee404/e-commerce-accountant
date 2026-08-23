import type { PeriodGranularity } from "@/lib/db/schema";

/**
 * The client's own rule for when a report is due, kept apart from any single
 * period's date. Monthly and quarterly reports carry only a day — the
 * deadline always falls in the month right after the period. Yearly reports
 * also carry a month, because "the year after" is not specific enough on its
 * own.
 */
export type DeadlineRule = {
  /** 1-31. Clamped to the target month's last day when it does not exist. */
  day: number;
  /** 1-12. Present only for yearly reports. */
  month: number | null;
};

export function defaultDeadlineRule(granularity: PeriodGranularity): DeadlineRule {
  return granularity === "year" ? { day: 31, month: 3 } : { day: 20, month: null };
}

/**
 * Whatever is stored, turned into a rule that can be relied on. Out-of-range
 * or missing values fall back to the default rather than being clamped
 * silently, so a corrupted row is obviously wrong instead of quietly moved.
 */
export function normaliseDeadlineRule(granularity: PeriodGranularity, raw: unknown): DeadlineRule {
  const fallback = defaultDeadlineRule(granularity);
  const value = (raw ?? {}) as { day?: unknown; month?: unknown };

  const day =
    typeof value.day === "number" && Number.isInteger(value.day) && value.day >= 1 && value.day <= 31
      ? value.day
      : fallback.day;

  if (granularity !== "year") return { day, month: null };

  const month =
    typeof value.month === "number" &&
    Number.isInteger(value.month) &&
    value.month >= 1 &&
    value.month <= 12
      ? value.month
      : fallback.month;

  return { day, month };
}

function lastDayOfMonth(year: number, month1based: number): number {
  // Day 0 of the month after the target rolls back to the target's last day.
  return new Date(Date.UTC(year, month1based, 0)).getUTCDate();
}

function isoDate(year: number, month1based: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month1based).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The calendar date a period is due, from the tenant's rule alone.
 *
 * Monthly and quarterly: the rule's day, in the month right after the period
 * ends. Yearly: the rule's day and month, in the year right after the period
 * ends. A day that does not exist in the target month — the 31st landing on
 * February — becomes that month's last day instead.
 */
export function computeDeadline(
  granularity: PeriodGranularity,
  periodEnd: string,
  rule: DeadlineRule,
): string {
  const year = Number(periodEnd.slice(0, 4));
  const month = Number(periodEnd.slice(5, 7));

  const [targetYear, targetMonth] =
    granularity === "year" ? [year + 1, rule.month ?? 1] : month === 12 ? [year + 1, 1] : [year, month + 1];

  const day = Math.min(rule.day, lastDayOfMonth(targetYear, targetMonth));

  return isoDate(targetYear, targetMonth, day);
}

export type DeadlineState =
  | { kind: "completed" }
  | { kind: "overdue"; days: number }
  | { kind: "due_today" }
  | { kind: "due_tomorrow" }
  | { kind: "due_in"; days: number };

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.UTC(
    Number(fromISO.slice(0, 4)),
    Number(fromISO.slice(5, 7)) - 1,
    Number(fromISO.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toISO.slice(0, 4)),
    Number(toISO.slice(5, 7)) - 1,
    Number(toISO.slice(8, 10)),
  );

  return Math.round((to - from) / 86_400_000);
}

/** Where a period stands against its deadline, as of a given day. */
export function deadlineState(
  deadline: string,
  today: string,
  completed: boolean,
): DeadlineState {
  if (completed) return { kind: "completed" };

  const days = daysBetween(today, deadline);

  if (days < 0) return { kind: "overdue", days: -days };
  if (days === 0) return { kind: "due_today" };
  if (days === 1) return { kind: "due_tomorrow" };

  return { kind: "due_in", days };
}

export function describeDeadlineState(state: DeadlineState): string {
  switch (state.kind) {
    case "completed":
      return "Completed";
    case "overdue":
      return `Overdue by ${state.days} day${state.days === 1 ? "" : "s"}`;
    case "due_today":
      return "Due today";
    case "due_tomorrow":
      return "Due tomorrow";
    case "due_in":
      return `Due in ${state.days} day${state.days === 1 ? "" : "s"}`;
  }
}

/**
 * One row of the dashboard's Report deadlines block, sorted into place.
 *
 * Order: overdue, most overdue first; then due today; then upcoming, soonest
 * first; then completed, latest deadline first. A single ordinal per group
 * keeps the comparator a plain number sort instead of a chain of tie-breaks.
 */
export function deadlineSortKey(state: DeadlineState): number {
  switch (state.kind) {
    case "overdue":
      // More overdue (larger days) sorts first, i.e. more negative.
      return -state.days;
    case "due_today":
      return 0;
    case "due_tomorrow":
      return 1;
    case "due_in":
      return state.days;
    case "completed":
      // A large finite number, not Infinity: two completed rows would
      // otherwise compare as Infinity - Infinity = NaN, an invalid sort
      // comparator result that some engines resolve inconsistently.
      return 1_000_000_000;
  }
}

export function compareDeadlineRows<T extends { state: DeadlineState; deadline: string }>(
  a: T,
  b: T,
): number {
  const byGroup = deadlineSortKey(a.state) - deadlineSortKey(b.state);

  if (byGroup !== 0) return byGroup;

  // Completed rows with the same group sort key (both "completed") order by
  // deadline, latest first.
  if (a.state.kind === "completed" && b.state.kind === "completed") {
    return a.deadline < b.deadline ? 1 : a.deadline > b.deadline ? -1 : 0;
  }

  return 0;
}
