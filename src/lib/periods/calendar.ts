import type { PeriodGranularity } from "@/lib/db/schema";
import { monthByNumber, quarterMonths } from "@/lib/ingest/months";
import { buildPeriod, buildYearPeriod, type Period, type YearMonth } from "@/lib/ingest/period";

import type { PeriodAnchors, PeriodSchedule } from "./schedule";
import { enabledGranularities } from "./schedule";

/**
 * The calendar, as pure arithmetic.
 *
 * Nothing here reads the clock. "Now" is always an argument, because a
 * scheduler that decides what day it is by itself cannot be tested on the
 * first of January, and this code has to be right on exactly those days.
 */

/**
 * A backstop against an anchor that cannot be true.
 *
 * Anchors are written by code, never typed in, so a date from decades back
 * means the rules row has been edited by hand or corrupted. Twenty years is
 * far past anything this application can have a period for, and stopping
 * there bounds the damage to something recognisable instead of opening two
 * centuries of empty months.
 */
const MAX_STEPS = 240;

type YearMonthPair = { year: number; month: number };

function parse(iso: string): YearMonthPair & { day: number } {
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
  };
}

function toYearMonth({ year, month }: YearMonthPair): YearMonth {
  const resolved = monthByNumber(month);

  if (!resolved) throw new Error(`Not a month: ${month}`);

  return { year, month: resolved };
}

function unwrap(result: ReturnType<typeof buildPeriod>): Period {
  // buildPeriod refuses month lists it cannot read. Every list built here is
  // one month or one whole calendar quarter, so a refusal is a bug in this
  // file rather than bad data, and should say so rather than return null.
  if (!result.ok) throw new Error(`Calendar built an impossible period: ${result.reason}`);

  return result.period;
}

export function monthPeriod(year: number, month: number): Period {
  return unwrap(buildPeriod([toYearMonth({ year, month })]));
}

export function quarterPeriod(year: number, quarter: number): Period {
  return unwrap(
    buildPeriod(quarterMonths(quarter).map((month) => toYearMonth({ year, month }))),
  );
}

/**
 * The fiscal year a date falls in, named by the year it starts in. With a
 * January start this is just the calendar year; with an April start, March
 * 2027 belongs to 2026.
 */
export function fiscalYearOf(iso: string, startMonth: number): number {
  const { year, month } = parse(iso);

  return month >= startMonth ? year : year - 1;
}

/** The period of one granularity that contains a given date. */
export function periodContaining(
  granularity: PeriodGranularity,
  iso: string,
  schedule: PeriodSchedule,
): Period {
  const { year, month } = parse(iso);

  if (granularity === "month") return monthPeriod(year, month);
  if (granularity === "quarter") return quarterPeriod(year, Math.ceil(month / 3));

  const fiscalYear = fiscalYearOf(iso, schedule.fiscalYearStartMonth);

  return buildYearPeriod(fiscalYear, schedule.fiscalYearStartMonth);
}

/**
 * Where a granularity starts being scheduled, when it is first turned on.
 *
 * The period being lived through, not the next one. Turning quarterly filing
 * on in the middle of Q3 should put Q3 on the screen — that is the quarter
 * being worked on. What it must not do is invent Q1 and Q2, and it does not:
 * everything before this anchor stays absent unless a file arrives for it.
 */
export function anchorFor(
  granularity: PeriodGranularity,
  iso: string,
  schedule: PeriodSchedule,
): string {
  return periodContaining(granularity, iso, schedule).start;
}

export function nextPeriod(
  granularity: PeriodGranularity,
  period: Period,
  schedule: PeriodSchedule,
): Period {
  const { year, month } = parse(period.start);

  if (granularity === "month") {
    return month === 12 ? monthPeriod(year + 1, 1) : monthPeriod(year, month + 1);
  }

  if (granularity === "quarter") {
    const quarter = Math.ceil(month / 3);

    return quarter === 4 ? quarterPeriod(year + 1, 1) : quarterPeriod(year, quarter + 1);
  }

  return buildYearPeriod(year + 1, schedule.fiscalYearStartMonth);
}

/**
 * Every period that should exist on a given day, given where each granularity
 * started.
 *
 * This is deliberately "what should exist by now" rather than "what opens
 * today". The two coincide on the first of the month and differ on every
 * other day — and it is the difference that makes a missed run harmless: a
 * scheduler that fires late, or not at all, still produces the same answer
 * the moment it does run.
 *
 * ISO dates compare correctly as text, which is why the bounds are compared
 * with `<=` on strings rather than through Date.
 */
export function periodsDue(
  anchors: PeriodAnchors,
  asOf: string,
  schedule: PeriodSchedule,
): Period[] {
  const due: Period[] = [];

  for (const granularity of enabledGranularities(schedule)) {
    const anchor = anchors[granularity];

    if (!anchor) continue;

    due.push(...periodsFrom(granularity, anchor, asOf, schedule));
  }

  return due;
}

/**
 * Every period of one granularity from `fromDate` up to (and including) the
 * one containing `asOf`.
 *
 * Unlike `periodsDue`, this walks forward from a date named explicitly
 * rather than from a stored anchor — it is what a one-off backfill uses when
 * someone deliberately asks for a run of periods that were never on the
 * schedule, e.g. a report's reporting-start date moving earlier than the
 * period the report itself was first turned on in.
 */
export function periodsFrom(
  granularity: PeriodGranularity,
  fromDate: string,
  asOf: string,
  schedule: PeriodSchedule,
): Period[] {
  const result: Period[] = [];
  let period = periodContaining(granularity, fromDate, schedule);
  let steps = 0;

  while (period.start <= asOf && steps < MAX_STEPS) {
    result.push(period);
    period = nextPeriod(granularity, period, schedule);
    steps += 1;
  }

  return result;
}
