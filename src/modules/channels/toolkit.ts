import type { Classification, Grid, RejectCode } from "@/lib/ingest/classify";
import type { DatasetId, SimpleDataset } from "@/lib/ingest/datasets";
import {
  buildPeriod,
  collectPeriods,
  parseAllegroDate,
  parseAmazonActivityPeriod,
  parseCdiscountDate,
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
  shopify: parseShopifyDate,
};

function readPeriodFromColumn(
  grid: Grid,
  dataset: SimpleDataset,
  headerRowIndex: number,
): Classification | { period: Period } {
  const headerRow = grid[headerRowIndex] ?? [];
  const columnIndex = headerIndex(headerRow, dataset.periodColumn, normaliseHeader);

  if (columnIndex === -1) {
    return reject(
      "PERIOD_COLUMN_NOT_FOUND",
      `Column "${dataset.periodColumn}" not found.`,
      dataset,
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
      dataset,
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
        dataset,
        headerRowIndex,
      );
    }

    found.push(parsed);
  }

  if (!sawUsableRow) {
    return reject("PERIOD_INVALID", "The file has no dated rows.", dataset, headerRowIndex);
  }

  const period = buildPeriod(collectPeriods(found));

  if (!period.ok) {
    return reject("PERIOD_INVALID", periodFailureMessage(period.reason), dataset, headerRowIndex);
  }

  return { period: period.period };
}

/**
 * The whole classification of a fixed-header channel: match the header row,
 * read the period out of the data. Null when the headers are not this
 * channel's — the caller tries the next module.
 */
export function classifySimpleChannel(profile: SimpleDataset, grid: Grid): Classification | null {
  const headerRow = grid[profile.headerRowIndex];

  if (!headerRow || !rowHasHeaders(headerRow, profile.requiredHeaders, normaliseHeader)) {
    return null;
  }

  const result = readPeriodFromColumn(grid, profile, profile.headerRowIndex);

  if ("ok" in result) return result;

  return {
    ok: true,
    dataset: profile.id,
    label: profile.label,
    country: null,
    marketplace: null,
    headerRowIndex: profile.headerRowIndex,
    period: result.period,
    periodSource: "data",
  };
}
