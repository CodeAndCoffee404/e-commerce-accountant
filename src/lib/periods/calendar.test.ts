import { describe, expect, it } from "vitest";

import { buildYearPeriod } from "@/lib/ingest/period";

import { anchorFor, fiscalYearOf, periodContaining, periodsDue } from "./calendar";
import { defaultSchedule, type PeriodSchedule } from "./schedule";

const all: PeriodSchedule = { month: true, quarter: true, year: true, fiscalYearStartMonth: 1 };

/** Anchored far enough back that every enabled granularity has begun. */
function anchoredAt(iso: string, schedule: PeriodSchedule) {
  return {
    month: anchorFor("month", iso, schedule),
    quarter: anchorFor("quarter", iso, schedule),
    year: anchorFor("year", iso, schedule),
  };
}

describe("what the calendar opens", () => {
  it("opens a month, a quarter and a year on the first of January", () => {
    const due = periodsDue(anchoredAt("2026-01-01", all), "2026-01-01", all);

    expect(due.map((period) => period.label)).toEqual([
      "2026.01 January",
      "2026.Q1",
      "2026.Y",
    ]);
  });

  it("adds April's own quarter, while January's year is still one of the due periods", () => {
    // periodsDue answers "what should exist by now", not "what is new today":
    // the year opened in January is still due in April. Deciding which of
    // these are new is the unique index's job, not this function's.
    const anchors = anchoredAt("2026-04-01", all);
    const due = periodsDue(anchors, "2026-04-01", all);

    expect(due.map((period) => period.label)).toEqual(["2026.04 April", "2026.Q2", "2026.Y"]);
  });

  it("opens only the month in a month that starts no quarter", () => {
    // Anchored in May, so the quarter and the year already began before the
    // schedule did and are not invented after the fact.
    const anchors = { month: "2026-05-01" };
    const due = periodsDue(anchors, "2026-05-31", all);

    expect(due.map((period) => period.label)).toEqual(["2026.05 May"]);
  });

  it("gives the same answer on the tenth as on the first", () => {
    const anchors = anchoredAt("2026-01-01", all);

    expect(periodsDue(anchors, "2026-01-10", all)).toEqual(
      periodsDue(anchors, "2026-01-01", all),
    );
  });

  it("catches up every period a silent scheduler missed", () => {
    const anchors = anchoredAt("2026-01-01", all);
    const due = periodsDue(anchors, "2026-08-22", all);

    expect(due.filter((period) => period.granularity === "month")).toHaveLength(8);
    expect(due.filter((period) => period.granularity === "quarter").map((p) => p.label)).toEqual([
      "2026.Q1",
      "2026.Q2",
      "2026.Q3",
    ]);
    expect(due.filter((period) => period.granularity === "year").map((p) => p.label)).toEqual([
      "2026.Y",
    ]);
  });

  it("crosses the new year", () => {
    const due = periodsDue({ month: "2026-11-01" }, "2027-02-15", all);

    expect(due.map((period) => period.label)).toEqual([
      "2026.11 November",
      "2026.12 December",
      "2027.01 January",
      "2027.02 February",
    ]);
  });

  it("opens nothing for a granularity that was never enabled", () => {
    const monthsOnly = { ...all, quarter: false, year: false };
    const due = periodsDue(anchoredAt("2026-01-01", all), "2026-06-30", monthsOnly);

    expect(due.every((period) => period.granularity === "month")).toBe(true);
  });

  it("opens nothing for an enabled granularity with no anchor", () => {
    expect(periodsDue({}, "2026-06-30", all)).toEqual([]);
  });

  it("stops rather than opening two centuries of months for a corrupt anchor", () => {
    const due = periodsDue({ month: "1900-01-01" }, "2026-08-22", all);

    expect(due).toHaveLength(240);
  });
});

describe("a fiscal year that does not start in January", () => {
  const april: PeriodSchedule = { ...all, fiscalYearStartMonth: 4 };

  it("runs from April to March and is named for the year it starts in", () => {
    const period = buildYearPeriod(2026, 4);

    expect(period).toEqual({
      label: "2026.Y",
      granularity: "year",
      start: "2026-04-01",
      end: "2027-03-31",
    });
  });

  it("puts March into the year before", () => {
    expect(fiscalYearOf("2027-03-31", 4)).toBe(2026);
    expect(fiscalYearOf("2027-04-01", 4)).toBe(2027);
  });

  it("leaves the quarters on the calendar", () => {
    // The classifier reads a file's own quarter, and that has to keep meaning
    // what it has always meant whatever the client's year does.
    expect(periodContaining("quarter", "2026-04-15", april).label).toBe("2026.Q2");
    expect(periodContaining("quarter", "2026-04-15", all).label).toBe("2026.Q2");
  });

  it("opens the next year in April, not in January", () => {
    const due = periodsDue({ year: "2026-04-01" }, "2027-01-15", april);

    expect(due.map((period) => period.label)).toEqual(["2026.Y"]);
    expect(periodsDue({ year: "2026-04-01" }, "2027-04-01", april).map((p) => p.label)).toEqual([
      "2026.Y",
      "2027.Y",
    ]);
  });

  it("handles a leap February as the last month of a fiscal year", () => {
    expect(buildYearPeriod(2023, 3).end).toBe("2024-02-29");
  });
});

describe("where a granularity starts when it is turned on", () => {
  it("takes the period being lived through, not the next one", () => {
    expect(anchorFor("quarter", "2026-08-22", all)).toBe("2026-07-01");
    expect(anchorFor("month", "2026-08-22", all)).toBe("2026-08-01");
    expect(anchorFor("year", "2026-08-22", all)).toBe("2026-01-01");
  });

  it("opens the current quarter but never the ones before it", () => {
    const anchors = { quarter: anchorFor("quarter", "2026-11-05", all) };
    const due = periodsDue(anchors, "2026-11-05", all);

    expect(due.map((period) => period.label)).toEqual(["2026.Q4"]);
  });

  it("defaults to months and quarters, with the year left off", () => {
    expect(defaultSchedule()).toEqual({
      month: true,
      quarter: true,
      year: false,
      fiscalYearStartMonth: 1,
    });
  });
});
