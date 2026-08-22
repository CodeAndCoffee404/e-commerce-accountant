import { describe, expect, it } from "vitest";

import {
  defaultSchedule,
  enabledGranularities,
  normaliseAnchors,
  normaliseSchedule,
} from "./schedule";

describe("reading a stored schedule", () => {
  it("falls back to the defaults when nothing is stored", () => {
    expect(normaliseSchedule(undefined)).toEqual(defaultSchedule());
    expect(normaliseSchedule(null)).toEqual(defaultSchedule());
    expect(normaliseSchedule({})).toEqual(defaultSchedule());
  });

  it("keeps what was stored", () => {
    expect(normaliseSchedule({ month: true, quarter: false, year: true })).toMatchObject({
      month: true,
      quarter: false,
      year: true,
    });
  });

  it("takes a field's default when only that field is missing", () => {
    // A row written before a field existed has to behave as the system did
    // before it existed, not disable everything around it.
    expect(normaliseSchedule({ year: true })).toEqual({
      month: true,
      quarter: true,
      year: true,
      fiscalYearStartMonth: 1,
    });
  });

  it("ignores a value that is not a boolean rather than guessing at it", () => {
    expect(normaliseSchedule({ month: "yes", quarter: 0 })).toMatchObject({
      month: true,
      quarter: true,
    });
  });

  it("refuses a fiscal start outside the calendar", () => {
    for (const start of [0, 13, -1, 4.5, "4", null]) {
      expect(normaliseSchedule({ fiscalYearStartMonth: start }).fiscalYearStartMonth).toBe(1);
    }

    expect(normaliseSchedule({ fiscalYearStartMonth: 4 }).fiscalYearStartMonth).toBe(4);
  });

  it("lists the enabled granularities finest first", () => {
    expect(enabledGranularities(defaultSchedule())).toEqual(["month", "quarter"]);
    expect(
      enabledGranularities({ month: false, quarter: false, year: true, fiscalYearStartMonth: 1 }),
    ).toEqual(["year"]);
  });
});

describe("reading stored anchors", () => {
  it("keeps ISO dates and drops anything else", () => {
    expect(
      normaliseAnchors({ month: "2026-08-01", quarter: "soon", year: 2026, other: "2026-01-01" }),
    ).toEqual({ month: "2026-08-01" });
  });

  it("treats a missing row as no anchors at all", () => {
    expect(normaliseAnchors(undefined)).toEqual({});
    expect(normaliseAnchors("nonsense")).toEqual({});
  });
});
