import { describe, expect, it } from "vitest";

import { monthByNumber } from "./months";
import {
  buildPeriod,
  collectPeriods,
  parseAllegroDate,
  parseAmazonActivityPeriod,
  parseAmazonMonthlyDate,
  parseCdiscountDate,
  parseShopifyDate,
  type YearMonth,
} from "./period";

function ym(year: number, month: number): YearMonth {
  const value = monthByNumber(month);
  if (!value) throw new Error(`no such month: ${month}`);

  return { year, month: value };
}

describe("buildPeriod", () => {
  it("builds a month label the way legacy writes it", () => {
    const result = buildPeriod([ym(2026, 7)]);

    expect(result).toEqual({
      ok: true,
      period: {
        label: "2026.07 July",
        granularity: "month",
        start: "2026-07-01",
        end: "2026-07-31",
      },
    });
  });

  it("knows about a leap February", () => {
    expect(buildPeriod([ym(2028, 2)])).toMatchObject({
      period: { end: "2028-02-29" },
    });
    expect(buildPeriod([ym(2026, 2)])).toMatchObject({
      period: { end: "2026-02-28" },
    });
  });

  it("builds a whole quarter", () => {
    expect(buildPeriod([ym(2026, 4), ym(2026, 6), ym(2026, 5)])).toEqual({
      ok: true,
      period: {
        label: "2026.Q2",
        granularity: "quarter",
        start: "2026-04-01",
        end: "2026-06-30",
      },
    });
  });

  it("rejects two months — that is neither a month nor a quarter", () => {
    expect(buildPeriod([ym(2026, 4), ym(2026, 5)])).toEqual({
      ok: false,
      reason: "INVALID_NUMBER_OF_MONTHS",
    });
  });

  it("rejects three months that do not form a calendar quarter", () => {
    expect(buildPeriod([ym(2026, 5), ym(2026, 6), ym(2026, 7)])).toEqual({
      ok: false,
      reason: "MULTIPLE_QUARTERS",
    });
  });

  it("rejects months in different years before it looks at quarters", () => {
    expect(buildPeriod([ym(2025, 11), ym(2025, 12), ym(2026, 1)])).toEqual({
      ok: false,
      reason: "MULTIPLE_YEARS",
    });
  });

  it("rejects an empty list", () => {
    expect(buildPeriod([])).toEqual({ ok: false, reason: "NO_PERIOD_VALUES" });
  });
});

describe("collectPeriods", () => {
  it("collapses repeats of the same month", () => {
    expect(collectPeriods([ym(2026, 7), ym(2026, 7), ym(2026, 8)])).toHaveLength(2);
  });
});

describe("parseAmazonActivityPeriod", () => {
  it("reads 2026-May in any case", () => {
    expect(parseAmazonActivityPeriod("2026-May")).toEqual(ym(2026, 5));
    expect(parseAmazonActivityPeriod("2026-MAY")).toEqual(ym(2026, 5));
    expect(parseAmazonActivityPeriod("2026-may")).toEqual(ym(2026, 5));
  });

  it("rejects formats from other channels", () => {
    expect(parseAmazonActivityPeriod("2026-05")).toBeNull();
    expect(parseAmazonActivityPeriod("May-2026")).toBeNull();
    expect(parseAmazonActivityPeriod("2026-Mayo")).toBeNull();
  });
});

describe("parseAllegroDate", () => {
  it("reads dd.MM.yyyy HH:mm", () => {
    expect(parseAllegroDate("31.07.2026 02:20")).toEqual(ym(2026, 7));
  });

  it("rejects a date that does not exist", () => {
    expect(parseAllegroDate("31.02.2026 02:20")).toBeNull();
  });

  it("rejects a date with no time", () => {
    expect(parseAllegroDate("31.07.2026")).toBeNull();
  });
});

describe("parseCdiscountDate", () => {
  it("reads both the text date and the XLSX date cell", () => {
    expect(parseCdiscountDate("2026-06-01")).toEqual(ym(2026, 6));
    expect(parseCdiscountDate("2026-06-01 00:00:00")).toEqual(ym(2026, 6));
  });

  it("refuses a time other than midnight — that is no longer an accounting date", () => {
    expect(parseCdiscountDate("2026-06-01 13:00:00")).toBeNull();
  });
});

describe("parseShopifyDate", () => {
  it("takes the calendar date as written, with no time-zone conversion", () => {
    // Converting to UTC would move this sale into June and break the period.
    expect(parseShopifyDate("2026-07-01 01:34:13 +0300")).toEqual(ym(2026, 7));
    expect(parseShopifyDate("2026-07-31 22:34:13 +0300")).toEqual(ym(2026, 7));
  });

  it("rejects an impossible offset", () => {
    expect(parseShopifyDate("2026-07-31 22:34:13 +1500")).toBeNull();
    expect(parseShopifyDate("2026-07-31 22:34:13 +1430")).toBeNull();
  });

  it("rejects a date with no offset", () => {
    expect(parseShopifyDate("2026-07-31 22:34:13")).toBeNull();
  });
});

describe("parseAmazonMonthlyDate", () => {
  it("reads the month names of all ten marketplaces", () => {
    expect(parseAmazonMonthlyDate("1 may 2026 13:33:54 UTC")).toEqual(ym(2026, 5));
    expect(parseAmazonMonthlyDate("30 giu 2026 22:55:46 UTC")).toEqual(ym(2026, 6));
    expect(parseAmazonMonthlyDate("1 lip 2026 12:04:49 UTC")).toEqual(ym(2026, 7));
    expect(parseAmazonMonthlyDate("6 maj 2026 07:16:12 UTC")).toEqual(ym(2026, 5));
    expect(parseAmazonMonthlyDate("5 mei 2026 20:16:37 UTC")).toEqual(ym(2026, 5));
    expect(parseAmazonMonthlyDate("2 Jul 2026 17:03:22 UTC")).toEqual(ym(2026, 7));
    expect(parseAmazonMonthlyDate("1 mai 2026 08:44:35 UTC")).toEqual(ym(2026, 5));
    expect(parseAmazonMonthlyDate("6 juil. 2026 21:30:47 UTC")).toEqual(ym(2026, 7));
  });

  it("reads the German numeric format", () => {
    expect(parseAmazonMonthlyDate("30.04.2026 22:42:06 UTC")).toEqual(ym(2026, 4));
  });

  it("rejects an unknown month name", () => {
    expect(parseAmazonMonthlyDate("1 foo 2026 13:33:54 UTC")).toBeNull();
  });
});
