import type { Classification, Grid, RejectCode } from "@/lib/ingest/classify";
import type { DatasetId, DatasetVariants, SimpleDataset } from "@/lib/ingest/datasets";
import {
  buildPeriod,
  collectPeriods,
  parseAllegroDate,
  parseAmazonActivityPeriod,
  parseCdiscountDate,
  parseCdiscountOrdersDate,
  parseShopifyDate,
  type Period,
  type YearMonth,
} from "@/lib/ingest/period";

/**
 * The shared machinery channel modules classify with. Modules depend on this
 * toolkit; the toolkit knows no channel by name.
 */

/**
 * BOM lives only in the very first cell of a file, so stripping it everywhere
 * would be wrong — a header could legitimately start with that character.
 */
export function normaliseHeader(value: string | undefined, isFirstCell: boolean): string {
  let text = value ?? "";

  if (isFirstCell) text = text.replace(/^﻿/, "");

  return text.trim().toUpperCase();
}

export type Normaliser = (value: string | undefined, isFirstCell: boolean) => string;

export function headerIndex(
  row: readonly string[],
  header: string,
  normalise: Normaliser,
): number {
  const wanted = normalise(header, false);

  return row.findIndex((value, index) => normalise(value, index === 0) === wanted);
}

export function rowHasHeaders(
  row: readonly string[],
  headers: readonly string[],
  normalise: Normaliser,
): boolean {
  const present = new Set(row.map((value, index) => normalise(value, index === 0)));

  return headers.every((header) => present.has(normalise(header, false)));
}

export function cell(grid: Grid, rowIndex: number, columnIndex: number): string {
  return (grid[rowIndex]?.[columnIndex] ?? "").trim();
}

export function reject(
  code: RejectCode,
  message: string,
  dataset: { id: DatasetId; label: string } | null,
  headerRowIndex: number | null,
): Classification {
  return {
    ok: false,
    dataset: dataset?.id ?? null,
    label: dataset?.label ?? null,
    headerRowIndex,
    code,
    message,
  };
}

export function periodFailureMessage(reason: string): string {
  switch (reason) {
    case "NO_PERIOD_VALUES":
      return "The file has no dates to derive a period from.";
    case "INVALID_NUMBER_OF_MONTHS":
      return "A file must cover one month or one whole quarter, and this covers neither.";
    case "MULTIPLE_YEARS":
      return "The file spans months in different years.";
    case "MULTIPLE_QUARTERS":
      return "The file spans months in different quarters.";
    case "INCOMPLETE_QUARTER":
      return "Three months, but not a whole calendar quarter.";
    default:
      return "The period could not be determined.";
  }
}

type DateParser = (value: string) => YearMonth | null;

const DATE_PARSERS: Record<SimpleDataset["periodResolver"], DateParser> = {
  amazon_vat: parseAmazonActivityPeriod,
  allegro: parseAllegroDate,
  cdiscount: parseCdiscountDate,
  cdiscount_orders: parseCdiscountOrdersDate,
  shopify: parseShopifyDate,
};

function readPeriodFromColumn(
  grid: Grid,
  dataset: SimpleDataset,
  headerRowIndex: number,
  /** What the file turned out to be, when that is not the profile itself. */
  identity: { id: DatasetId; label: string } = dataset,
): Classification | { period: Period } {
  const headerRow = grid[headerRowIndex] ?? [];
  const columnIndex = headerIndex(headerRow, dataset.periodColumn, normaliseHeader);

  if (columnIndex === -1) {
    return reject(
      "PERIOD_COLUMN_NOT_FOUND",
      `Column "${dataset.periodColumn}" not found.`,
      identity,
      headerRowIndex,
    );
  }

  const filterIndex = dataset.periodFilterColumn
    ? headerIndex(headerRow, dataset.periodFilterColumn, normaliseHeader)
    : -1;

  if (dataset.periodFilterColumn && filterIndex === -1) {
    return reject(
      "PERIOD_COLUMN_NOT_FOUND",
      `Column "${dataset.periodFilterColumn}" not found.`,
      identity,
      headerRowIndex,
    );
  }

  const parse = DATE_PARSERS[dataset.periodResolver];
  const found: YearMonth[] = [];
  let sawUsableRow = false;

  for (let rowIndex = headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    if (filterIndex !== -1) {
      const filterValue = cell(grid, rowIndex, filterIndex).toUpperCase();

      if (filterValue !== dataset.periodFilterValue) continue;
    }

    sawUsableRow = true;

    const raw = cell(grid, rowIndex, columnIndex);
    if (raw === "") continue;

    const parsed = parse(raw);

    if (!parsed) {
      return reject(
        "PERIOD_INVALID",
        `Value "${raw}" in column "${dataset.periodColumn}" is not a date this channel writes.`,
        identity,
        headerRowIndex,
      );
    }

    found.push(parsed);
  }

  if (!sawUsableRow) {
    return reject("PERIOD_INVALID", "The file has no dated rows.", identity, headerRowIndex);
  }

  const period = buildPeriod(collectPeriods(found));

  if (!period.ok) {
    return reject("PERIOD_INVALID", periodFailureMessage(period.reason), identity, headerRowIndex);
  }

  return { period: period.period };
}

/**
 * The whole classification of a fixed-header channel: match the header row,
 * read the period out of the data. Null when the headers are not this
 * channel's — the caller tries the next module.
 *
 * `variants` is for a layout more than one dataset shares — two shops of the
 * same platform, say. The headers cannot separate them, so the contents do,
 * and a file that does not clearly belong to one of them is refused.
 */
export function classifySimpleChannel(
  profile: SimpleDataset,
  grid: Grid,
  variants?: DatasetVariants,
): Classification | null {
  const headerRow = grid[profile.headerRowIndex];

  if (!headerRow || !rowHasHeaders(headerRow, profile.requiredHeaders, normaliseHeader)) {
    return null;
  }

  let dataset = profile.id as DatasetId;
  let label = profile.label;

  if (variants) {
    const chosen = chooseVariant(grid, profile.headerRowIndex, variants);

    if ("ok" in chosen) return chosen;

    dataset = chosen.member.id;
    label = chosen.member.label;
  }

  const result = readPeriodFromColumn(grid, profile, profile.headerRowIndex, { id: dataset, label });

  if ("ok" in result) return result;

  return {
    ok: true,
    dataset,
    label,
    country: null,
    marketplace: null,
    headerRowIndex: profile.headerRowIndex,
    period: result.period,
    periodSource: "data",
  };
}

/**
 * Counts the votes the signals cast over every data row and returns the
 * winner — or a refusal.
 *
 * Guessing here is the expensive mistake: a file filed under the wrong shop
 * is invoiced under the wrong company, in the wrong currency, under the wrong
 * VAT scheme, and nothing downstream can notice. So the bar is a clear
 * majority of a decent number of votes, and everything else is handed back to
 * the person who uploaded the file, who knows which shop it came from.
 */
function chooseVariant(
  grid: Grid,
  headerRowIndex: number,
  variants: DatasetVariants,
): Classification | { member: DatasetVariants["members"][number] } {
  const headerRow = grid[headerRowIndex] ?? [];
  const tally = new Map<DatasetId, number>();
  let cast = 0;

  const columns = variants.signals.map((signal) => ({
    signal,
    index: headerIndex(headerRow, signal.column, normaliseHeader),
  }));

  for (let rowIndex = headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    for (const { signal, index } of columns) {
      if (index === -1) continue;

      const value = cell(grid, rowIndex, index).toUpperCase();

      if (value === "") continue;

      const voted = signal.contains
        ? Object.entries(signal.votes).find(([needle]) => value.includes(needle))?.[1]
        : signal.votes[value];

      if (!voted) continue;

      tally.set(voted, (tally.get(voted) ?? 0) + 1);
      cast += 1;
    }
  }

  const names = variants.members.map((member) => member.label).join(", ");

  if (cast < variants.minimumVotes) {
    return reject(
      "VARIANT_NOT_DETECTED",
      `The layout matches ${names}, but the file says too little about which one it is. ` +
        "Check that it is a full export and not a filtered extract.",
      null,
      headerRowIndex,
    );
  }

  const [leader, votes] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];

  if (votes / cast < variants.majority) {
    const shares = [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => {
        const member = variants.members.find((candidate) => candidate.id === id);

        return `${member?.label ?? id} ${Math.round((count / cast) * 100)}%`;
      })
      .join(", ");

    return reject(
      "VARIANT_NOT_DETECTED",
      `The file looks like more than one report at once (${shares}). ` +
        "Split it so each upload covers a single one.",
      null,
      headerRowIndex,
    );
  }

  const member = variants.members.find((candidate) => candidate.id === leader);

  if (!member) {
    return reject("VARIANT_NOT_DETECTED", `Unknown variant: ${leader}.`, null, headerRowIndex);
  }

  return { member };
}
