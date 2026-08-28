import type { PeriodGranularity } from "@/lib/db/schema";

import {
  monthByAbbreviation,
  monthByLocalisedName,
  monthByNumber,
  quarterMonths,
  type Month,
} from "./months";

export type YearMonth = { year: number; month: Month };

export type Period = {
  /** `2026.07 July`, `2026.Q3` or `2026.Y` — legacy's wording where it has one. */
  label: string;
  /**
   * Taken from the database enum rather than spelled out again. The two used
   * to be written separately and drifted the moment one of them learned a new
   * value; now widening the column is what widens this.
   *
   * A period a file can carry is still only a month or a quarter — that is
   * what `buildPeriod` will produce, and the classifier is the only thing that
   * builds one from a file. Longer periods are assembled from the months
   * inside them and never arrive as an upload.
   */
  granularity: PeriodGranularity;
  /** ISO calendar dates, inclusive. */
  start: string;
  end: string;
};

export type PeriodResult =
  | { ok: true; period: Period }
  | { ok: false; reason: PeriodFailure };

export type PeriodFailure =
  | "NO_PERIOD_VALUES"
  | "INVALID_NUMBER_OF_MONTHS"
  | "MULTIPLE_YEARS"
  | "MULTIPLE_QUARTERS"
  | "INCOMPLETE_QUARTER";

const MIN_YEAR = 1900;
const MAX_YEAR = 9999;

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * A file covers either a single month or one whole calendar quarter — never an
 * arbitrary range. §2.1 of the plan leans on that: replacement is by slice, and
 * slices may only coincide or be unrelated, never partially overlap.
 */
export function buildPeriod(values: readonly YearMonth[]): PeriodResult {
  if (values.length === 0) return { ok: false, reason: "NO_PERIOD_VALUES" };

  if (values.length === 1) {
    const { year, month } = values[0];

    return {
      ok: true,
      period: {
        label: `${year}.${month.numberText} ${month.fullName}`,
        granularity: "month",
        start: isoDate(year, month.number, 1),
        end: isoDate(year, month.number, lastDayOfMonth(year, month.number)),
      },
    };
  }

  if (values.length !== 3) return { ok: false, reason: "INVALID_NUMBER_OF_MONTHS" };

  const years = new Set(values.map((value) => value.year));
  if (years.size !== 1) return { ok: false, reason: "MULTIPLE_YEARS" };

  const quarters = new Set(values.map((value) => value.month.quarter));
  if (quarters.size !== 1) return { ok: false, reason: "MULTIPLE_QUARTERS" };

  const year = values[0].year;
  const quarter = values[0].month.quarter;
  const actual = values.map((value) => value.month.number).sort((a, b) => a - b);
  const expected = quarterMonths(quarter);

  if (!expected.every((month, index) => actual[index] === month)) {
    return { ok: false, reason: "INCOMPLETE_QUARTER" };
  }

  const lastMonth = expected[2];

  return {
    ok: true,
    period: {
      label: `${year}.Q${quarter}`,
      granularity: "quarter",
      start: isoDate(year, expected[0], 1),
      end: isoDate(year, lastMonth, lastDayOfMonth(year, lastMonth)),
    },
  };
}

/**
 * A whole year, which no file ever carries.
 *
 * Deliberately not part of `buildPeriod`: that function reads a period out of
 * a file's contents and may see one month or three, never twelve. A year is
 * assembled from the months inside it, so it is built from a number rather
 * than from data.
 *
 * `startMonth` moves the fiscal year without moving the quarters. Quarters
 * stay calendar quarters because `Month.quarter` and the classifier are built
 * on that, and a file's own quarter must keep meaning what it has always
 * meant.
 */
export function buildYearPeriod(year: number, startMonth = 1): Period {
  const endYear = startMonth === 1 ? year : year + 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;

  return {
    // The year it starts in, so a fiscal year running April to March is
    // 2026.Y and not something that has to be read twice.
    label: `${year}.Y`,
    granularity: "year",
    start: isoDate(year, startMonth, 1),
    end: isoDate(endYear, endMonth, lastDayOfMonth(endYear, endMonth)),
  };
}

/**
 * A period label, read back into words instead of decoded from its format —
 * "July 2026", "Q3 2026", "2026" — with the granularity named alongside it
 * so a month and a quarter never look alike at a glance next to each other,
 * the way `2026.07 July` and `2026.Q3` can when skimmed quickly.
 */
export function describePeriodLabel(label: string, granularity: PeriodGranularity): string {
  if (granularity === "month") {
    const words = monthLabelWords(label);

    if (words !== label) return `${words} (month)`;
  }

  if (granularity === "quarter") {
    const match = /^(\d{4})\.Q(\d)$/.exec(label);

    if (match) return `Q${match[2]} ${match[1]} (quarter)`;
  }

  if (granularity === "year") {
    const match = /^(\d{4})\.Y$/.exec(label);

    if (match) return `${match[1]} (year)`;
  }

  // A label that doesn't match its own granularity's shape is unexpected
  // rather than impossible — shown as-is rather than hidden behind a guess.
  return label;
}

/** `2026.07 July` -> `July 2026`, matching how the dashboard's month picker itself reads a period. */
export function monthLabelWords(label: string): string {
  const match = /^\d{4}\.\d{2} (.+)$/.exec(label);

  return match ? `${match[1]} ${label.slice(0, 4)}` : label;
}

/**
 * `2026.07 July` -> `Jul 2026` — the same reading as `monthLabelWords`,
 * shortened for places that show many months side by side (the History
 * matrix fits up to thirteen columns, and full month names would force a
 * horizontal scroll far sooner).
 */
export function monthLabelShort(label: string): string {
  const match = /^\d{4}\.\d{2} (.+)$/.exec(label);

  return match ? `${match[1].slice(0, 3)} ${label.slice(0, 4)}` : label;
}

/** `2026.07 July` -> `July`, for prose that already names the year elsewhere. */
export function monthLabelName(label: string): string | null {
  const match = /^\d{4}\.\d{2} (.+)$/.exec(label);

  return match ? match[1] : null;
}

/** Deduplicates while preserving nothing but year+month — the rest is noise. */
export function collectPeriods(values: Iterable<YearMonth>): YearMonth[] {
  const unique = new Map<string, YearMonth>();

  for (const value of values) {
    unique.set(`${value.year}-${value.month.numberText}`, value);
  }

  return [...unique.values()];
}

function validYear(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * Rejects a date that does not exist, such as 31 February. Round-tripping
 * through Date is the cheapest way to ask the calendar.
 */
function calendarDateExists(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function toYearMonth(year: number, monthNumber: number, day: number): YearMonth | null {
  if (!validYear(year) || !calendarDateExists(year, monthNumber, day)) return null;

  const month = monthByNumber(monthNumber);

  return month ? { year, month } : null;
}

/**
 * Every parser below is deliberately strict about its channel's one format.
 * A loose parser that guesses between `01.02.2026` as day-first and month-first
 * would silently move a transaction into the wrong month.
 */

/** Amazon VAT `ACTIVITY_PERIOD`: `2026-May`. */
export function parseAmazonActivityPeriod(value: string): YearMonth | null {
  const match = value.trim().match(/^(\d{4})-([A-Za-z]{3})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = monthByAbbreviation(match[2]);

  return validYear(year) && month ? { year, month } : null;
}

/** Allegro `data`: `31.07.2026 02:20`. */
export function parseAllegroDate(value: string): YearMonth | null {
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, day, month, year, hour, minute] = match.map(Number);

  if (hour > 23 || minute > 59) return null;

  return toYearMonth(year, month, day);
}

/**
 * Cdiscount `Accounting date`: `2026-06-01`.
 *
 * The same value arrives two ways. In the CSV it is text; in the XLSX it is a
 * real date cell, which reaches us as `2026-06-01 00:00:00`. Both are the same
 * calendar date, so the time is accepted and ignored — the channel posts
 * accounting dates, never timestamps.
 */
export function parseCdiscountDate(value: string): YearMonth | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]00:00:00)?$/);
  if (!match) return null;

  const [, year, month, day] = match.map(Number);

  return toYearMonth(year, month, day);
}

/**
 * Cdiscount orders report `Order date (UTC)`: `2026-08-25 15:50:30` in the
 * XLSX (a real date cell, per parse.ts's `cellToString`), `2026-08-25` alone
 * in a CSV export of the same report. Unlike the invoice report's `Accounting
 * date`, this column carries a real time of day, not always midnight.
 */
export function parseCdiscountOrdersDate(value: string): YearMonth | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}:\d{2})?$/);
  if (!match) return null;

  const [, year, month, day] = match.map(Number);

  return toYearMonth(year, month, day);
}

/** Shopify `Created at`: `2026-07-31 22:34:13 +0300`. */
export function parseShopifyDate(value: string): YearMonth | null {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-])(\d{2})(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[8]);
  const offsetMinute = Number(match[9]);

  if (hour > 23 || minute > 59 || second > 59) return null;
  if (offsetHour > 14 || offsetMinute > 59) return null;
  if (offsetHour === 14 && offsetMinute !== 0) return null;

  // The offset is validated but deliberately not applied. Converting
  // `2026-07-31 22:34:13 +0300` to UTC would move the transaction into June,
  // and legacy takes the calendar date as written. See PLAN §5, stage 1.
  return toYearMonth(year, month, day);
}

/**
 * Amazon Monthly date column, written in the marketplace's language:
 * `1 may 2026 13:33:54 UTC`, `30.04.2026 22:42:06 UTC`, `6 juil. 2026 ...`.
 */
export function parseAmazonMonthlyDate(value: string): YearMonth | null {
  const trimmed = value.trim();

  const numeric = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (numeric) {
    const [, day, month, year] = numeric.map(Number);

    return toYearMonth(year, month, day);
  }

  const named = trimmed.match(/^(\d{1,2})\s+([^\s\d]+)\.?\s+(\d{4})\b/);
  if (!named) return null;

  const day = Number(named[1]);
  const month = monthByLocalisedName(named[2]);
  const year = Number(named[3]);

  return month ? toYearMonth(year, month.number, day) : null;
}
