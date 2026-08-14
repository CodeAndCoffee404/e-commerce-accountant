import { parseAmazonVatDate } from "./dates";
import { Attention, RowReader } from "./reader";
import type { MapContext, MapResult, MappedTransaction } from "./types";

/**
 * Amazon's VAT transaction report. Amounts are plain decimals with a dot, and
 * every figure the ledger needs already exists as its own column — nothing here
 * has to be derived, which is why this is the channel reports are reconciled
 * against.
 */
export function mapAmazonVat({ grid, headerRowIndex }: MapContext): MapResult {
  const reader = new RowReader(grid, headerRowIndex, ".");
  const rows: MappedTransaction[] = [];

  for (let rowIndex = reader.firstDataRow; rowIndex < reader.rowCount; rowIndex += 1) {
    if (reader.isBlank(rowIndex)) continue;

    const attention = new Attention();

    const gross = attention.take(reader.decimal(rowIndex, "TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL"));
    const net = attention.take(reader.decimal(rowIndex, "TOTAL_ACTIVITY_VALUE_AMT_VAT_EXCL"));
    const vat = attention.take(reader.decimal(rowIndex, "TOTAL_ACTIVITY_VALUE_VAT_AMT"));
    const rate = attention.take(reader.decimal(rowIndex, "PRICE_OF_ITEMS_VAT_RATE_PERCENT"));
    const quantity = attention.take(reader.decimal(rowIndex, "QTY"));

    const occurredOn = parseAmazonVatDate(reader.text(rowIndex, "TRANSACTION_COMPLETE_DATE"))
      ?? parseAmazonVatDate(reader.text(rowIndex, "TAX_CALCULATION_DATE"));

    if (occurredOn === null) attention.add("Не удалось определить дату транзакции.");

    rows.push({
      sourceRowNumber: rowIndex + 1,
      dataset: "amazon_vat",
      channel: "amazon",
      // The report covers every marketplace at once, so the country belongs to
      // the row, not to the file.
      countryCode: reader.text(rowIndex, "SALE_ARRIVAL_COUNTRY"),

      naturalKey: [
        reader.text(rowIndex, "TRANSACTION_EVENT_ID"),
        reader.text(rowIndex, "ACTIVITY_TRANSACTION_ID"),
      ]
        .filter(Boolean)
        .join("/") || null,
      occurredOn,
      transactionType: reader.text(rowIndex, "TRANSACTION_TYPE"),

      currency: reader.text(rowIndex, "TRANSACTION_CURRENCY_CODE"),
      gross,
      vatAmount: vat,
      netAmount: net,
      vatRate: rate,

      departureCountry: reader.text(rowIndex, "SALE_DEPART_COUNTRY"),
      arrivalCountry: reader.text(rowIndex, "SALE_ARRIVAL_COUNTRY"),
      sellerVatNumber: reader.text(rowIndex, "TRANSACTION_SELLER_VAT_NUMBER"),
      buyerVatNumber: reader.text(rowIndex, "BUYER_VAT_NUMBER"),
      taxScheme: reader.text(rowIndex, "TAX_REPORTING_SCHEME"),

      sku: reader.text(rowIndex, "SELLER_SKU"),
      quantity,

      needsAttention: attention.needsAttention,
      attentionReason: attention.reason,
      raw: reader.raw(rowIndex),
    });
  }

  return { rows, missingColumns: reader.missingColumns };
}
