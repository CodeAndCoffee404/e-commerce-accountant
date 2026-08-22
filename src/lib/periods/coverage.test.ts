import { describe, expect, it } from "vitest";

import { resolveCoverage, uncoveredMonths, type CoverageCandidate } from "./coverage";

const Q3 = { start: "2026-07-01", end: "2026-09-30" };
const YEAR = { start: "2026-01-01", end: "2026-12-31" };

function monthly(
  id: string,
  dataset: string,
  month: number,
  countryCode: string | null = null,
): CoverageCandidate {
  const padded = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(2026, month, 0)).getUTCDate();

  return {
    id,
    dataset,
    countryCode,
    periodStart: `2026-${padded}-01`,
    periodEnd: `2026-${padded}-${lastDay}`,
    granularity: "month",
  };
}

function quarterly(id: string, dataset: string, quarter: number): CoverageCandidate {
  const first = (quarter - 1) * 3 + 1;
  const last = first + 2;
  const lastDay = new Date(Date.UTC(2026, last, 0)).getUTCDate();

  return {
    id,
    dataset,
    countryCode: null,
    periodStart: `2026-${String(first).padStart(2, "0")}-01`,
    periodEnd: `2026-${String(last).padStart(2, "0")}-${lastDay}`,
    granularity: "quarter",
  };
}

const ids = (files: CoverageCandidate[]) => files.map((file) => file.id).sort();

describe("assembling a quarter from months", () => {
  it("takes all three months", () => {
    const files = [monthly("jul", "allegro", 7), monthly("aug", "allegro", 8), monthly("sep", "allegro", 9)];

    expect(ids(resolveCoverage(Q3, files))).toEqual(["aug", "jul", "sep"]);
  });

  it("leaves out months belonging to another quarter", () => {
    const files = [monthly("jun", "allegro", 6), monthly("jul", "allegro", 7)];

    expect(ids(resolveCoverage(Q3, files))).toEqual(["jul"]);
  });

  it("takes the quarterly export when the channel sends one", () => {
    expect(ids(resolveCoverage(Q3, [quarterly("q3", "amazon_vat", 3)]))).toEqual(["q3"]);
  });
});

describe("a slice that has both a quarter and its months", () => {
  it("counts the quarter and drops the months it already contains", () => {
    // The whole reason this module exists: summing both would report the
    // quarter's revenue twice while looking entirely plausible.
    const files = [
      quarterly("q3", "amazon_vat", 3),
      monthly("jul", "amazon_vat", 7),
      monthly("aug", "amazon_vat", 8),
      monthly("sep", "amazon_vat", 9),
    ];

    expect(ids(resolveCoverage(Q3, files))).toEqual(["q3"]);
  });

  it("keeps months from a different channel, which are not the same revenue", () => {
    const files = [
      quarterly("q3", "amazon_vat", 3),
      monthly("jul", "allegro", 7),
      monthly("aug", "allegro", 8),
    ];

    expect(ids(resolveCoverage(Q3, files))).toEqual(["aug", "jul", "q3"]);
  });

  it("keeps months from the same channel in a different country", () => {
    const files = [
      monthly("de", "amazon_monthly", 7, "DE"),
      monthly("fr", "amazon_monthly", 7, "FR"),
    ];

    expect(ids(resolveCoverage(Q3, files))).toEqual(["de", "fr"]);
  });

  it("fills a year's gaps with months and takes the quarter where there is one", () => {
    const files = [
      quarterly("q3", "amazon_vat", 3),
      monthly("jan", "amazon_vat", 1),
      monthly("aug", "amazon_vat", 8),
      monthly("dec", "amazon_vat", 12),
    ];

    // August is inside Q3 and is dropped; January and December cover ground
    // the quarter does not, and are kept.
    expect(ids(resolveCoverage(YEAR, files))).toEqual(["dec", "jan", "q3"]);
  });

  it("resolves identically however the database returned the rows", () => {
    const files = [
      monthly("jul", "amazon_vat", 7),
      quarterly("q3", "amazon_vat", 3),
      monthly("sep", "amazon_vat", 9),
    ];

    expect(resolveCoverage(Q3, files)).toEqual(resolveCoverage(Q3, [...files].reverse()));
  });
});

describe("what a period is still missing", () => {
  it("names the months nothing covers", () => {
    expect(uncoveredMonths(Q3, [monthly("jul", "allegro", 7)])).toEqual([
      "2026-08-01",
      "2026-09-01",
    ]);
  });

  it("says nothing is missing once a quarterly export covers it", () => {
    expect(uncoveredMonths(Q3, [quarterly("q3", "amazon_vat", 3)])).toEqual([]);
  });

  it("counts a month as missing when only another channel covers it", () => {
    // Coverage is per period here, not per slice: this answers whether the
    // period has any data for a month at all.
    expect(uncoveredMonths(Q3, [])).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
  });

  it("treats a single month as one month", () => {
    const july = { start: "2026-07-01", end: "2026-07-31" };

    expect(uncoveredMonths(july, [])).toEqual(["2026-07-01"]);
    expect(uncoveredMonths(july, [monthly("jul", "allegro", 7)])).toEqual([]);
  });

  it("walks a whole year without running past its end", () => {
    expect(uncoveredMonths(YEAR, [])).toHaveLength(12);
  });
});
