import { monthByLocalisedName } from "../months";

/**
 * Calendar dates are taken exactly as the file writes them, with no time-zone
 * conversion. Legacy does the same, and it matters: converting
 * `2026-07-31 22:34:13 +0300` to UTC moves that sale into June and the period
 * assigned to the file no longer matches its contents.
 */
function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Amazon VAT writes `01-07-2026`, day first. */
export function parseAmazonVatDate(value: string | null): string | null {
  const match = (value ?? "").trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;

  return iso(Number(match[3]), Number(match[2]), Number(match[1]));
}

/** Allegro writes `31.07.2026 21:21`. */
export function parseAllegroTimestamp(value: string | null): string | null {
  const match = (value ?? "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;

  return iso(Number(match[3]), Number(match[2]), Number(match[1]));
}

/** Cdiscount writes `2026-07-02`, and the XLSX adds a midnight time. */
export function parseIsoDate(value: string | null): string | null {
  const match = (value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  return iso(Number(match[1]), Number(match[2]), Number(match[3]));
}

/**
 * Amazon Monthly writes the timestamp in the marketplace's language:
 * `01.07.2026 02:01:45 UTC` in German, `1 may 2026 13:33:54 UTC` in Spanish,
 * `6 juil. 2026 21:30:47 UTC` in French.
 */
export function parseAmazonMonthlyTimestamp(value: string | null): string | null {
  const text = (value ?? "").trim();

  const numeric = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (numeric) return iso(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));

  const named = text.match(/^(\d{1,2})\s+([^\s\d]+)\.?\s+(\d{4})/);
  if (!named) return null;

  const month = monthByLocalisedName(named[2]);

  return month ? iso(Number(named[3]), month.number, Number(named[1])) : null;
}
