import type { PeriodGranularity } from "@/lib/db/schema";

/**
 * How often this tenant opens periods, and from when.
 *
 * Stored as rows in channel_rules under the "periods" channel, the same way
 * report configuration is stored under "reports": this is the client's own
 * description of how their filing works, which is reference data, not schema.
 */
export const PERIODS_CHANNEL = "periods";
export const SCHEDULE_KEY = "schedule";
export const ANCHOR_KEY = "anchor";

export type PeriodSchedule = {
  month: boolean;
  quarter: boolean;
  year: boolean;
  /**
   * 1–12. Moves the year only. Quarters stay calendar quarters, because a
   * file's own quarter is read by the classifier and has to keep meaning what
   * it has always meant.
   */
  fiscalYearStartMonth: number;
};

/**
 * Where each granularity started being scheduled. Forward-only is the whole
 * point: turning quarters on in November opens Q4 and never invents Q1.
 *
 * A granularity with no anchor has never been enabled; the first run that
 * sees it enabled writes one.
 */
export type PeriodAnchors = Partial<Record<PeriodGranularity, string>>;

export const GRANULARITIES: readonly PeriodGranularity[] = ["month", "quarter", "year"];

/**
 * Months and quarters on, years off.
 *
 * Not arbitrary: this client files monthly and their channels issue whole
 * quarters — an Amazon VAT export covering three months is a quarter the
 * classifier already recognises. A year, by contrast, is a period no report
 * module can be built for yet, and a default that opens empty periods nobody
 * asked for is a default that makes the page worse.
 */
export function defaultSchedule(): PeriodSchedule {
  return { month: true, quarter: true, year: false, fiscalYearStartMonth: 1 };
}

/**
 * Turns whatever is stored into a schedule that can be relied on.
 *
 * Every field falls back to the default, so a missing row, a half-written
 * value, or a row written before a field existed all behave as the defaults
 * do. A fiscal start outside 1–12 is not clamped but ignored: silently
 * shifting someone's year to the nearest legal month would be a worse answer
 * than the one they would have got by saying nothing.
 */
export function normaliseSchedule(raw: unknown): PeriodSchedule {
  const value = (raw ?? {}) as Record<string, unknown>;
  const fallback = defaultSchedule();

  const flag = (key: "month" | "quarter" | "year") =>
    typeof value[key] === "boolean" ? (value[key] as boolean) : fallback[key];

  const start = value.fiscalYearStartMonth;
  const fiscalYearStartMonth =
    typeof start === "number" && Number.isInteger(start) && start >= 1 && start <= 12
      ? start
      : fallback.fiscalYearStartMonth;

  return {
    month: flag("month"),
    quarter: flag("quarter"),
    year: flag("year"),
    fiscalYearStartMonth,
  };
}

/** The granularities this tenant currently opens, coarsest last. */
export function enabledGranularities(schedule: PeriodSchedule): PeriodGranularity[] {
  return GRANULARITIES.filter((granularity) => schedule[granularity]);
}

/**
 * Anchors, tolerant of anything stored. A value that is not an ISO date is
 * dropped rather than repaired: a broken anchor that parses as some other
 * date would open a run of periods nobody asked for, while a dropped one is
 * simply written again on the next run.
 */
export function normaliseAnchors(raw: unknown): PeriodAnchors {
  const value = (raw ?? {}) as Record<string, unknown>;
  const result: PeriodAnchors = {};

  for (const granularity of GRANULARITIES) {
    const stored = value[granularity];

    if (typeof stored === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stored)) {
      result[granularity] = stored;
    }
  }

  return result;
}
