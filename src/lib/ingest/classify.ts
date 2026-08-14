import {
  AMAZON_MARKETPLACE_DOMAINS,
  AMAZON_MONTHLY_HEADER_SEARCH_ROWS,
  AMAZON_MONTHLY_PROFILES,
  SIMPLE_DATASETS,
  amazonMonthlyLabel,
  type AmazonCountry,
  type AmazonMonthlyProfile,
  type DatasetId,
  type SimpleDataset,
} from "./datasets";
import { monthByNumber, monthByLocalisedName } from "./months";
import {
  buildPeriod,
  collectPeriods,
  parseAllegroDate,
  parseAmazonActivityPeriod,
  parseAmazonMonthlyDate,
  parseCdiscountDate,
  parseShopifyDate,
  type Period,
  type YearMonth,
} from "./period";

export type Grid = readonly (readonly string[])[];

export type Classification =
  | {
      ok: true;
      dataset: DatasetId;
      label: string;
      country: AmazonCountry | null;
      marketplace: string | null;
      headerRowIndex: number;
      period: Period;
      /** How the period was established, for display and for support. */
      periodSource: "data" | "filename";
    }
  | {
      ok: false;
      /** Present once the layout was recognised but something else failed. */
      dataset: DatasetId | null;
      label: string | null;
      headerRowIndex: number | null;
      code: RejectCode;
      message: string;
    };

export type RejectCode =
  | "EMPTY_FILE"
  | "TYPE_NOT_DETECTED"
  | "PERIOD_COLUMN_NOT_FOUND"
  | "PERIOD_INVALID"
  | "COUNTRY_NOT_DETECTED";

/**
 * BOM lives only in the very first cell of a file, so stripping it everywhere
 * would be wrong — a header could legitimately start with that character.
 */
function normaliseHeader(value: string | undefined, isFirstCell: boolean): string {
  let text = value ?? "";

  if (isFirstCell) text = text.replace(/^﻿/, "");

  return text.trim().toUpperCase();
}

/**
 * Amazon's localised headers pick up a non-breaking space and, in the Italian
 * export, a trailing colon: the header reads `Data/Ora:` while every other
 * language writes it bare.
 */
function normaliseAmazonHeader(value: string | undefined, isFirstCell: boolean): string {
  let text = value ?? "";

  if (isFirstCell) text = text.replace(/^﻿/, "");

  return text.replace(/ /g, " ").trim().replace(/:\s*$/, "").trim().toUpperCase();
}

type Normaliser = (value: string | undefined, isFirstCell: boolean) => string;

function headerIndex(row: readonly string[], header: string, normalise: Normaliser): number {
  const wanted = normalise(header, false);

  return row.findIndex((value, index) => normalise(value, index === 0) === wanted);
}

function rowHasHeaders(
  row: readonly string[],
  headers: readonly string[],
  normalise: Normaliser,
): boolean {
  const present = new Set(row.map((value, index) => normalise(value, index === 0)));

  return headers.every((header) => present.has(normalise(header, false)));
}

function cell(grid: Grid, rowIndex: number, columnIndex: number): string {
  return (grid[rowIndex]?.[columnIndex] ?? "").trim();
}

/* ------------------------------------------------------------------ *
 * Period strategies, one per channel
 * ------------------------------------------------------------------ */

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

function periodFailureMessage(reason: string): string {
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

function reject(
  code: RejectCode,
  message: string,
  dataset: SimpleDataset | { id: DatasetId; label: string } | null,
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

/* ------------------------------------------------------------------ *
 * Amazon Monthly
 * ------------------------------------------------------------------ */

type AmazonMatch = {
  profile: AmazonMonthlyProfile;
  headerRowIndex: number;
  marketplaceColumnIndex: number;
};

function findAmazonMonthlyLayout(grid: Grid): AmazonMatch | null {
  const rowsToCheck = Math.min(grid.length, AMAZON_MONTHLY_HEADER_SEARCH_ROWS);

  for (const profile of AMAZON_MONTHLY_PROFILES) {
    for (let rowIndex = 0; rowIndex < rowsToCheck; rowIndex += 1) {
      const row = grid[rowIndex] ?? [];

      if (!rowHasHeaders(row, profile.requiredHeaders, normaliseAmazonHeader)) continue;

      return {
        profile,
        headerRowIndex: rowIndex,
        marketplaceColumnIndex: headerIndex(row, profile.marketplaceHeader, normaliseAmazonHeader),
      };
    }
  }

  return null;
}

function findMarketplaceValue(grid: Grid, startRow: number, columnIndex: number): string | null {
  if (columnIndex === -1) return null;

  for (let rowIndex = startRow; rowIndex < grid.length; rowIndex += 1) {
    const value = cell(grid, rowIndex, columnIndex);

    if (value && value.toLowerCase().startsWith("amazon")) return value;
  }

  return null;
}

/**
 * Legacy reads the period out of the filename Amazon gives the download, and
 * nothing else. That is fragile — a renamed file loses its period — so the
 * filename is still tried first, for parity, and the date column is read when
 * the name says nothing.
 */
export function parseAmazonMonthlyFilenamePeriod(filename: string): YearMonth | null {
  const amazonDownload = filename.match(
    /^(\d{4})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i,
  );

  if (amazonDownload) {
    const month = monthByLocalisedName(amazonDownload[2]);

    return month ? { year: Number(amazonDownload[1]), month } : null;
  }

  // The archive renames files to `... - 2026.05 May.csv`.
  const archived = filename.match(/(\d{4})\.(\d{2})\s/);

  if (archived) {
    const month = monthByNumber(Number(archived[2]));

    return month ? { year: Number(archived[1]), month } : null;
  }

  return null;
}

function classifyAmazonMonthly(
  grid: Grid,
  filename: string,
  match: AmazonMatch,
): Classification {
  const marketplace = findMarketplaceValue(
    grid,
    match.headerRowIndex + 1,
    match.marketplaceColumnIndex,
  );

  let country: AmazonCountry | null = null;

  if (marketplace) {
    country = AMAZON_MARKETPLACE_DOMAINS[marketplace.toLowerCase()] ?? null;

    if (!country) {
      return reject(
        "COUNTRY_NOT_DETECTED",
        `Marketplace "${marketplace}" is not one this system knows.`,
        null,
        match.headerRowIndex,
      );
    }
  } else {
    country = match.profile.fallbackCountry;
  }

  if (!country) {
    return reject(
      "COUNTRY_NOT_DETECTED",
      "The report type was recognised but not its country: the marketplace column is empty.",
      null,
      match.headerRowIndex,
    );
  }

  const dataset = { id: "amazon_monthly" as const, label: amazonMonthlyLabel(country) };

  const fromFilename = parseAmazonMonthlyFilenamePeriod(filename);

  if (fromFilename) {
    const period = buildPeriod([fromFilename]);

    if (period.ok) {
      return {
        ok: true,
        dataset: dataset.id,
        label: dataset.label,
        country,
        marketplace,
        headerRowIndex: match.headerRowIndex,
        period: period.period,
        periodSource: "filename",
      };
    }
  }

  const dateColumnIndex = headerIndex(
    grid[match.headerRowIndex] ?? [],
    match.profile.dateHeader,
    normaliseAmazonHeader,
  );

  if (dateColumnIndex === -1) {
    return reject(
      "PERIOD_COLUMN_NOT_FOUND",
      `Column "${match.profile.dateHeader}" is missing and the filename carries no period.`,
      dataset,
      match.headerRowIndex,
    );
  }

  const found: YearMonth[] = [];

  for (let rowIndex = match.headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const raw = cell(grid, rowIndex, dateColumnIndex);
    if (raw === "") continue;

    const parsed = parseAmazonMonthlyDate(raw);

    if (!parsed) {
      return reject(
        "PERIOD_INVALID",
        `Value "${raw}" in the date column could not be read.`,
        dataset,
        match.headerRowIndex,
      );
    }

    found.push(parsed);
  }

  const period = buildPeriod(collectPeriods(found));

  if (!period.ok) {
    return reject(
      "PERIOD_INVALID",
      periodFailureMessage(period.reason),
      dataset,
      match.headerRowIndex,
    );
  }

  return {
    ok: true,
    dataset: dataset.id,
    label: dataset.label,
    country,
    marketplace,
    headerRowIndex: match.headerRowIndex,
    period: period.period,
    periodSource: "data",
  };
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function classify(grid: Grid, filename: string): Classification {
  if (grid.length === 0) {
    return reject("EMPTY_FILE", "The file is empty.", null, null);
  }

  // Amazon Monthly first: its header sits below a preamble, and checking the
  // fixed-row datasets against a preamble row can only ever miss.
  const amazonMatch = findAmazonMonthlyLayout(grid);

  if (amazonMatch) return classifyAmazonMonthly(grid, filename, amazonMatch);

  for (const dataset of SIMPLE_DATASETS) {
    const headerRow = grid[dataset.headerRowIndex];

    if (!headerRow || !rowHasHeaders(headerRow, dataset.requiredHeaders, normaliseHeader)) {
      continue;
    }

    const result = readPeriodFromColumn(grid, dataset, dataset.headerRowIndex);

    if ("ok" in result) return result;

    return {
      ok: true,
      dataset: dataset.id,
      label: dataset.label,
      country: null,
      marketplace: null,
      headerRowIndex: dataset.headerRowIndex,
      period: result.period,
      periodSource: "data",
    };
  }

  return reject(
    "TYPE_NOT_DETECTED",
    "Report type not recognised: no set of required headers matched.",
    null,
    null,
  );
}
