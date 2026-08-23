import { describe, expect, it } from "vitest";

import {
  compareDeadlineRows,
  computeDeadline,
  deadlineState,
  defaultDeadlineRule,
  describeDeadlineState,
  normaliseDeadlineRule,
} from "./deadlines";

describe("computeDeadline", () => {
  it("puts a monthly deadline on the given day of the following month", () => {
    // VAT Report for July 2026, deadline day 5 → 5 August 2026.
    expect(computeDeadline("month", "2026-07-31", { day: 5, month: null })).toBe("2026-08-05");
  });

  it("rolls a December month deadline into January of the next year", () => {
    expect(computeDeadline("month", "2026-12-31", { day: 10, month: null })).toBe("2027-01-10");
  });

  it("puts a quarterly deadline on the given day of the month after the quarter ends", () => {
    // Quarterly Report for Q2 2026, deadline day 15 → 15 July 2026.
    expect(computeDeadline("quarter", "2026-06-30", { day: 15, month: null })).toBe("2026-07-15");
  });

  it("puts a yearly deadline on the given month and day of the following year", () => {
    // Annual Report for 2026, deadline month March, day 31 → 31 March 2027.
    expect(computeDeadline("year", "2026-12-31", { day: 31, month: 3 })).toBe("2027-03-31");
  });

  it("clamps a day that does not exist in the target month to its last day", () => {
    // Deadline day 31, target month February (non-leap and leap alike).
    expect(computeDeadline("month", "2026-01-31", { day: 31, month: null })).toBe("2026-02-28");
    expect(computeDeadline("month", "2028-01-31", { day: 31, month: null })).toBe("2028-02-29");
  });
});

describe("normaliseDeadlineRule", () => {
  it("falls back to the default for anything unrecognised", () => {
    for (const raw of [null, undefined, 42, "off", { day: "5" }, { day: 0 }, { day: 32 }]) {
      expect(normaliseDeadlineRule("month", raw)).toEqual(defaultDeadlineRule("month"));
    }
  });

  it("keeps month null outside of yearly reports even if one is stored", () => {
    expect(normaliseDeadlineRule("month", { day: 5, month: 3 })).toEqual({ day: 5, month: null });
  });

  it("falls back the month separately from the day for yearly reports", () => {
    expect(normaliseDeadlineRule("year", { day: 31, month: 13 })).toEqual({
      day: 31,
      month: defaultDeadlineRule("year").month,
    });
  });
});

describe("deadlineState and describeDeadlineState", () => {
  const today = "2026-08-23";

  it("reports overdue, due today, due tomorrow and due in N days", () => {
    expect(deadlineState("2026-08-20", today, false)).toEqual({ kind: "overdue", days: 3 });
    expect(deadlineState("2026-08-23", today, false)).toEqual({ kind: "due_today" });
    expect(deadlineState("2026-08-24", today, false)).toEqual({ kind: "due_tomorrow" });
    expect(deadlineState("2026-08-26", today, false)).toEqual({ kind: "due_in", days: 3 });
  });

  it("is completed whenever the report has been built, whatever the date says", () => {
    expect(deadlineState("2026-08-20", today, true)).toEqual({ kind: "completed" });
    expect(deadlineState("2026-09-20", today, true)).toEqual({ kind: "completed" });
  });

  it("describes each state the way the dashboard shows it", () => {
    expect(describeDeadlineState({ kind: "overdue", days: 2 })).toBe("Overdue by 2 days");
    expect(describeDeadlineState({ kind: "overdue", days: 1 })).toBe("Overdue by 1 day");
    expect(describeDeadlineState({ kind: "due_today" })).toBe("Due today");
    expect(describeDeadlineState({ kind: "due_tomorrow" })).toBe("Due tomorrow");
    expect(describeDeadlineState({ kind: "due_in", days: 3 })).toBe("Due in 3 days");
    expect(describeDeadlineState({ kind: "completed" })).toBe("Completed");
  });
});

describe("compareDeadlineRows", () => {
  it("orders overdue (worst first), due today, upcoming, then completed", () => {
    const rows = [
      { key: "upcoming-far", state: { kind: "due_in" as const, days: 10 }, deadline: "2026-09-02" },
      { key: "completed-early", state: { kind: "completed" as const }, deadline: "2026-07-05" },
      { key: "overdue-2", state: { kind: "overdue" as const, days: 2 }, deadline: "2026-08-21" },
      { key: "due-today", state: { kind: "due_today" as const }, deadline: "2026-08-23" },
      { key: "completed-late", state: { kind: "completed" as const }, deadline: "2026-08-10" },
      { key: "overdue-5", state: { kind: "overdue" as const, days: 5 }, deadline: "2026-08-18" },
      { key: "due-tomorrow", state: { kind: "due_tomorrow" as const }, deadline: "2026-08-24" },
    ];

    const sorted = rows.sort(compareDeadlineRows).map((row) => row.key);

    expect(sorted).toEqual([
      "overdue-5",
      "overdue-2",
      "due-today",
      "due-tomorrow",
      "upcoming-far",
      "completed-late",
      "completed-early",
    ]);
  });
});
