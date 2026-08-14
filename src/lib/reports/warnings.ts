/**
 * Collapses a run's warnings into something a person can read.
 *
 * A generator warns per row, which is right — it is the only moment it knows
 * the row number. But three hundred lines of "unknown operation on row N" is
 * not a report on what went wrong, it is a wall that hides it. Identical
 * problems become one line with a count and the first row to look at.
 */
export function summariseWarnings(warnings: readonly string[]): string[] {
  const groups = new Map<string, { count: number; original: string; firstRow: number | null }>();

  for (const warning of warnings) {
    // Everything but the row number, which is the only part that varies.
    const key = warning.replace(ROW_REFERENCE, "").replace(/\s{2,}/g, " ").trim();
    const row = firstRowNumber(warning);
    const seen = groups.get(key);

    if (seen) {
      seen.count += 1;
      if (row !== null && (seen.firstRow === null || row < seen.firstRow)) seen.firstRow = row;
    } else {
      groups.set(key, { count: 1, original: warning, firstRow: row });
    }
  }

  return [...groups.values()].map(({ count, original, firstRow }) => {
    if (count === 1) return original;

    const key = original.replace(ROW_REFERENCE, "").replace(/\s{2,}/g, " ").trim();

    return firstRow === null
      ? `${key} — ${count} times`
      : `${key} — ${count} rows, first on row ${firstRow}`;
  });
}

/** "on row 12", ", row 12" and " row 12" all appear in the generators. */
const ROW_REFERENCE = /(,?\s*(on\s+)?row\s+\d+)/gi;

function firstRowNumber(warning: string): number | null {
  const match = /row\s+(\d+)/i.exec(warning);

  return match ? Number(match[1]) : null;
}
