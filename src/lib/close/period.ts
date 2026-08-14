import { monthByNumber } from "@/lib/ingest/months";
import { buildPeriod } from "@/lib/ingest/period";

/**
 * The month before a monthly period label, in the same byte-for-byte format
 * the classifier writes: "2026.07 July" -> "2026.06 June". Quarters and
 * anything unparseable return null — there is nothing meaningful to compare a
 * quarter against here.
 */
export function previousMonthLabel(label: string): string | null {
  const match = /^(\d{4})\.(\d{2})\s/.exec(label);

  if (!match) return null;

  let year = Number(match[1]);
  let monthNumber = Number(match[2]) - 1;

  if (monthNumber === 0) {
    monthNumber = 12;
    year -= 1;
  }

  const month = monthByNumber(monthNumber);

  if (!month) return null;

  const result = buildPeriod([{ year, month }]);

  return result.ok ? result.period.label : null;
}
