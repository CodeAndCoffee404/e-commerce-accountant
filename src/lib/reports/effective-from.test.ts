import { describe, expect, it } from "vitest";

import { defaultSchedule } from "@/lib/periods/schedule";

import {
  MIN_EFFECTIVE_FROM_YEARS_BACK,
  previewEffectiveFromChange,
  validateEffectiveFrom,
} from "./effective-from";

const schedule = defaultSchedule();

describe("validateEffectiveFrom", () => {
  it("accepts a past date", () => {
    expect(validateEffectiveFrom("2026-01-01", "2026-08-23")).toBeNull();
  });

  it("refuses a date in the future", () => {
    expect(validateEffectiveFrom("2027-01-01", "2026-08-23")).toMatch(/future/);
  });

  it(`refuses a date more than ${MIN_EFFECTIVE_FROM_YEARS_BACK} years back — a typo, not a real filing date`, () => {
    expect(validateEffectiveFrom("2006-01-01", "2026-08-23")).toMatch(/cannot be before/);
  });

  it("accepts a date exactly at the floor", () => {
    expect(validateEffectiveFrom("2021-08-23", "2026-08-23")).toBeNull();
  });

  it("refuses something that is not a date at all", () => {
    expect(validateEffectiveFrom("not-a-date", "2026-08-23")).not.toBeNull();
  });
});

describe("previewEffectiveFromChange", () => {
  it("lists every month and quarter it would open, and nothing to hide, the first time a date is set", () => {
    const preview = previewEffectiveFromChange(
      ["month", "quarter"],
      "2026-01-01",
      "2026-08-23",
      schedule,
      [],
      null,
    );

    expect(preview.willCreate).toEqual([
      { granularity: "month", count: 8, from: "2026.01 January", to: "2026.08 August" },
      { granularity: "quarter", count: 3, from: "2026.Q1", to: "2026.Q3" },
    ]);
    expect(preview.willHide).toEqual([]);
  });

  it("creates nothing for periods that already exist, and hides nothing moving to an earlier date", () => {
    const existing = [
      { label: "2026.06 June", granularity: "month" as const, start: "2026-06-01" },
      { label: "2026.07 July", granularity: "month" as const, start: "2026-07-01" },
      { label: "2026.08 August", granularity: "month" as const, start: "2026-08-01" },
    ];

    const preview = previewEffectiveFromChange(
      ["month"],
      "2026-06-01",
      "2026-08-23",
      schedule,
      existing,
      null,
    );

    expect(preview.willCreate).toEqual([]);
    expect(preview.willHide).toEqual([]);
  });

  it("hides existing periods, without creating anything, when the date moves later", () => {
    const months = ["01", "02", "03", "04", "05", "06", "07", "08"];
    const names = ["January", "February", "March", "April", "May", "June", "July", "August"];
    const existing = months.map((month, index) => ({
      label: `2026.${month} ${names[index]}`,
      granularity: "month" as const,
      start: `2026-${month}-01`,
    }));

    const preview = previewEffectiveFromChange(
      ["month"],
      "2026-03-01",
      "2026-08-23",
      schedule,
      existing,
      "2026-01-01",
    );

    expect(preview.willCreate).toEqual([]);
    expect(preview.willHide).toEqual([
      { granularity: "month", count: 2, labels: ["2026.01 January", "2026.02 February"] },
    ]);
  });

  it("never proposes hiding a period that was already outside the current reporting window", () => {
    // Only what the report currently shows can stop being shown — a period
    // already excluded by the old effectiveFrom is not "newly hidden".
    const existing = [
      { label: "2025.12 December", granularity: "month" as const, start: "2025-12-01" },
      { label: "2026.01 January", granularity: "month" as const, start: "2026-01-01" },
    ];

    const preview = previewEffectiveFromChange(
      ["month"],
      "2026-02-01",
      "2026-08-23",
      schedule,
      existing,
      "2026-01-01",
    );

    expect(preview.willHide).toEqual([
      { granularity: "month", count: 1, labels: ["2026.01 January"] },
    ]);
  });
});
