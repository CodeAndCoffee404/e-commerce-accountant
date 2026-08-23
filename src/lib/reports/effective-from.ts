import type { PeriodGranularity } from "@/lib/db/schema";
import { periodsFrom } from "@/lib/periods/calendar";
import type { PeriodSchedule } from "@/lib/periods/schedule";

/**
 * How far back a reporting-start date is allowed to reach.
 *
 * Not a business rule — a backstop against a typo. A date this far back is
 * further than any tenant on this system has ever traded, so refusing it
 * outright catches "2006" typed for "2026" before it asks the database to
 * open two decades of empty periods.
 */
export const MIN_EFFECTIVE_FROM_YEARS_BACK = 5;

function minAllowedDate(today: string): string {
  const year = Number(today.slice(0, 4)) - MIN_EFFECTIVE_FROM_YEARS_BACK;

  return `${year}${today.slice(4)}`;
}

/** Null when `newDate` is acceptable; otherwise the reason it is refused. */
export function validateEffectiveFrom(newDate: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return "That is not a date.";
  if (newDate > today) return "The reporting start date cannot be in the future.";

  const floor = minAllowedDate(today);

  if (newDate < floor) return `The reporting start date cannot be before ${floor}.`;

  return null;
}

export type EffectiveFromPreview = {
  willCreate: { granularity: PeriodGranularity; count: number; from: string; to: string }[];
  willHide: { granularity: PeriodGranularity; count: number; labels: string[] }[];
};

/**
 * What moving a report's reporting-start date to `newDate` would do, without
 * doing any of it — the numbers the admin confirms before anything is
 * written.
 *
 * Two independent things can happen, and either, both, or neither can be
 * true for a given granularity: moving the date earlier can open periods
 * that never existed (`willCreate`); moving it later, earlier, or both can
 * take periods that already exist out of this report's checklist
 * (`willHide`). Nothing here ever deletes a period or an upload — `willHide`
 * is a read-time filter, not a mutation.
 */
export function previewEffectiveFromChange(
  granularities: PeriodGranularity[],
  newDate: string,
  today: string,
  schedule: PeriodSchedule,
  existingPeriods: { label: string; granularity: PeriodGranularity; start: string }[],
  currentEffectiveFrom: string | null,
): EffectiveFromPreview {
  const willCreate: EffectiveFromPreview["willCreate"] = [];
  const willHide: EffectiveFromPreview["willHide"] = [];
  const existingLabels = new Set(existingPeriods.map((period) => period.label));

  for (const granularity of granularities) {
    const candidates = periodsFrom(granularity, newDate, today, schedule);
    const missing = candidates.filter((period) => !existingLabels.has(period.label));

    if (missing.length > 0) {
      willCreate.push({
        granularity,
        count: missing.length,
        from: missing[0].label,
        to: missing[missing.length - 1].label,
      });
    }

    const hidden = existingPeriods.filter(
      (period) =>
        period.granularity === granularity &&
        period.start < newDate &&
        (currentEffectiveFrom === null || period.start >= currentEffectiveFrom),
    );

    if (hidden.length > 0) {
      willHide.push({
        granularity,
        count: hidden.length,
        labels: hidden.map((period) => period.label),
      });
    }
  }

  return { willCreate, willHide };
}
