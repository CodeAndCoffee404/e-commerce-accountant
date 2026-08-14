import { describe, expect, it } from "vitest";

import { previousMonthLabel } from "./period";

describe("previous month label", () => {
  it("steps back within a year", () => {
    expect(previousMonthLabel("2026.07 July")).toBe("2026.06 June");
  });

  it("rolls over a year boundary", () => {
    expect(previousMonthLabel("2026.01 January")).toBe("2025.12 December");
  });

  it("refuses a quarter", () => {
    // A quarter has three predecessors of its own kind, not one month.
    expect(previousMonthLabel("2026.Q2")).toBeNull();
  });

  it("refuses garbage", () => {
    expect(previousMonthLabel("July 2026")).toBeNull();
  });
});
