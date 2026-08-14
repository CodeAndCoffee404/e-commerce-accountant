import type { Classification, Grid } from "@/lib/ingest/classify";
import { amazonMonthlyLabel, type AmazonCountry } from "@/lib/ingest/datasets";
import { monthByLocalisedName, monthByNumber } from "@/lib/ingest/months";
import {
  buildPeriod,
  collectPeriods,
  parseAmazonMonthlyDate,
  type YearMonth,
} from "@/lib/ingest/period";

import { cell, headerIndex, periodFailureMessage, reject, rowHasHeaders } from "../toolkit";
import type { ChannelModule } from "../types";

import {
  AMAZON_MONTHLY_COLUMNS,
  amazonMonthlyCurrency,
  amazonMonthlyDecimalSeparator,
} from "./columns";
import { parseAmazonMonthlyTimestamp } from "@/lib/ingest/mappers/dates";
import { wholeUnitsProblem } from "@/lib/ingest/numbers";
import { Attention, RowReader } from "@/lib/ingest/mappers/reader";
import type { MapContext, MapResult, MappedTransaction } from "@/lib/ingest/mappers/types";

/**
 * Amazon's monthly transaction report, one file per marketplace.
 *
 * This is the channel the production bug lived in: the old system wrote every
 * cell into a spreadsheet as text, then divided one cell by another with a
 * formula. In the eight comma-decimal marketplaces that division produced 0,
 * and fifty invoice lines shipped priced at nothing. Here the number is parsed
 * once, with the separator the marketplace actually uses, and an unreadable
 * value flags its row rather than becoming zero.
 */
export function mapAmazonMonthly({ grid, headerRowIndex, country }: MapContext): MapResult {
  const separator = amazonMonthlyDecimalSeparator(country);
  const reader = new RowReader(grid, headerRowIndex, separator);
  const currency = amazonMonthlyCurrency(country);
  const rows: MappedTransaction[] = [];

  // The profile fixes the language of the five identifying columns; the money
  // columns are matched by candidate name, because the same language serves
  // marketplaces with different layouts.
  const profile = AMAZON_MONTHLY_PROFILES.find((candidate) =>
    candidate.requiredHeaders.every((header) =>
      reader.headers.some((actual) => equalHeader(actual, header)),
    ),
  );

  if (!profile) {
    return { rows, missingColumns: ["the header layout matches no known marketplace language"] };
  }

  const [dateHeader, settlementHeader, typeHeader, orderHeader, skuHeader] =
    profile.requiredHeaders;

  for (let rowIndex = reader.firstDataRow; rowIndex < reader.rowCount; rowIndex += 1) {
    if (reader.isBlank(rowIndex)) continue;

    const attention = new Attention();

    const sales = attention.take(reader.decimalOf(rowIndex, AMAZON_MONTHLY_COLUMNS.sales));
    const tax = attention.take(reader.decimalOf(rowIndex, AMAZON_MONTHLY_COLUMNS.salesTax));
    const total = attention.take(reader.decimalOf(rowIndex, AMAZON_MONTHLY_COLUMNS.total));
    const quantity = attention.take(reader.decimalOf(rowIndex, AMAZON_MONTHLY_COLUMNS.quantity));

    // A fraction here means the wrong column was matched, not half a filter.
    attention.add(wholeUnitsProblem(quantity, "quantity"));

    const occurredOn = parseAmazonMonthlyTimestamp(reader.text(rowIndex, dateHeader));

    if (occurredOn === null) attention.add("The transaction date could not be read.");

    rows.push({
      sourceRowNumber: rowIndex + 1,
      dataset: "amazon_monthly",
      channel: "amazon",
      countryCode: country,

      naturalKey:
        [reader.text(rowIndex, settlementHeader), reader.text(rowIndex, orderHeader)]
          .filter(Boolean)
          .join("/") || null,
      occurredOn,
      transactionType: reader.text(rowIndex, typeHeader),

      currency,
      // `total` is what Amazon actually settles: sales less fees plus tax. The
      // sale itself and its tax are kept separately, because a report needs
      // the taxable base, not the payout.
      gross: total,
      vatAmount: tax,
      netAmount: sales,
      vatRate: null,

      departureCountry: null,
      arrivalCountry: country,
      sellerVatNumber: null,
      buyerVatNumber: null,
      taxScheme: null,

      sku: reader.text(rowIndex, skuHeader),
      quantity,

      needsAttention: attention.needsAttention,
      attentionReason: attention.reason,
      raw: reader.raw(rowIndex),
    });
  }

  return { rows, missingColumns: reader.missingColumns };
}

function equalHeader(actual: string, expected: string): boolean {
  const clean = (value: string) =>
    value.replace(/^﻿/, "").replace(/ /g, " ").trim().replace(/:\s*$/, "").trim().toUpperCase();

  return clean(actual) === clean(expected);
}

/* ------------------------------------------------------------------ *
 * Recognition
 * ------------------------------------------------------------------ */

/**
 * Amazon writes the monthly transaction report in the marketplace's language,
 * so the same report has nine different header rows. The profile identifies the
 * layout; the country comes from the marketplace column, because one language
 * can serve several marketplaces — English covers both UK and IE, and the
 * French layout covers FR and BE.
 */
export type AmazonMonthlyProfile = {
  key: string;
  requiredHeaders: readonly string[];
  marketplaceHeader: string;
  /** Used when no row carries a marketplace value; null means "must be read". */
  fallbackCountry: AmazonCountry | null;
  /** Column holding the transaction timestamp, for the period fallback. */
  dateHeader: string;
};

const HEADER_SEARCH_ROWS = 20;

export const AMAZON_MONTHLY_PROFILES: readonly AmazonMonthlyProfile[] = [
  {
    key: "ES",
    requiredHeaders: ["fecha y hora", "identificador de pago", "tipo", "número de pedido", "sku"],
    marketplaceHeader: "web de Amazon",
    fallbackCountry: "ES",
    dateHeader: "fecha y hora",
  },
  {
    key: "IT",
    requiredHeaders: ["Data/Ora", "Numero pagamento", "Tipo", "Numero ordine", "SKU"],
    marketplaceHeader: "Marketplace",
    fallbackCountry: "IT",
    dateHeader: "Data/Ora",
  },
  {
    key: "FR",
    requiredHeaders: ["date/heure", "numéro de versement", "type", "numéro de la commande", "sku"],
    marketplaceHeader: "Marketplace",
    fallbackCountry: "FR",
    dateHeader: "date/heure",
  },
  {
    key: "FR_ALT",
    requiredHeaders: [
      "date/heure",
      "Identifiant du paiement",
      "type",
      "Numéro de la commande",
      "SKU",
    ],
    marketplaceHeader: "site de vente",
    fallbackCountry: null,
    dateHeader: "date/heure",
  },
  {
    key: "DE",
    requiredHeaders: ["Datum/Uhrzeit", "Abrechnungsnummer", "Typ", "Bestellnummer", "SKU"],
    marketplaceHeader: "Marketplace",
    fallbackCountry: "DE",
    dateHeader: "Datum/Uhrzeit",
  },
  {
    key: "SE",
    requiredHeaders: ["datum/tid", "reglerings-id", "typ", "beställnings-id", "sku"],
    marketplaceHeader: "marknadsplats",
    fallbackCountry: "SE",
    dateHeader: "datum/tid",
  },
  {
    key: "PL",
    requiredHeaders: [
      "data/godzina",
      "identyfikator rozliczenia",
      "typ",
      "identyfikator zamówienia",
      "sku",
    ],
    marketplaceHeader: "rynek",
    fallbackCountry: "PL",
    dateHeader: "data/godzina",
  },
  {
    key: "NL",
    requiredHeaders: ["datum/tijd", "schikkings-ID", "type", "bestelnummer", "sku"],
    marketplaceHeader: "marketplace",
    fallbackCountry: "NL",
    dateHeader: "datum/tijd",
  },
  {
    key: "EN",
    requiredHeaders: ["date/time", "settlement ID", "type", "order ID", "sku"],
    marketplaceHeader: "marketplace",
    fallbackCountry: null,
    dateHeader: "date/time",
  },
] as const;

export const AMAZON_MARKETPLACE_DOMAINS: Readonly<Record<string, AmazonCountry>> = {
  "amazon.es": "ES",
  "amazon.it": "IT",
  "amazon.fr": "FR",
  "amazon.de": "DE",
  "amazon.co.uk": "UK",
  "amazon.se": "SE",
  "amazon.pl": "PL",
  "amazon.nl": "NL",
  "amazon.ie": "IE",
  "amazon.com.be": "BE",
};

/**
 * Amazon's localised headers pick up a non-breaking space and, in the Italian
 * export, a trailing colon: the header reads `Data/Ora:` while every other
 * language writes it bare.
 */
function normaliseAmazonHeader(value: string | undefined, isFirstCell: boolean): string {
  let text = value ?? "";

  if (isFirstCell) text = text.replace(/^﻿/, "");

  // The non-breaking space is written as an escape on purpose: as a literal
  // character it is indistinguishable from a space in review, and losing it
  // would silently stop the localised headers matching.
  return text.replace(/\u00a0/g, " ").trim().replace(/:\s*$/, "").trim().toUpperCase();
}

type AmazonMatch = {
  profile: AmazonMonthlyProfile;
  headerRowIndex: number;
  marketplaceColumnIndex: number;
};

function findLayout(grid: Grid): AmazonMatch | null {
  const rowsToCheck = Math.min(grid.length, HEADER_SEARCH_ROWS);

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

function classifyAmazonMonthly(grid: Grid, filename: string): Classification | null {
  const match = findLayout(grid);

  if (!match) return null;

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

export const amazonMonthlyModule: ChannelModule = {
  id: "amazon_monthly",
  shortName: "Amazon Monthly",
  classify: classifyAmazonMonthly,
  map: mapAmazonMonthly,
  // Driven by VAT rates and SKU mapping, both reference data of their own.
  defaultRules: [],
};
