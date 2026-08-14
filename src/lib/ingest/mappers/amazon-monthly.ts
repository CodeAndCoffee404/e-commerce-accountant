import { AMAZON_MONTHLY_PROFILES } from "../datasets";
import {
  AMAZON_MONTHLY_COLUMNS,
  amazonMonthlyCurrency,
  amazonMonthlyDecimalSeparator,
} from "./amazon-monthly-columns";
import { parseAmazonMonthlyTimestamp } from "./dates";
import { Attention, RowReader } from "./reader";
import type { MapContext, MapResult, MappedTransaction } from "./types";

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
