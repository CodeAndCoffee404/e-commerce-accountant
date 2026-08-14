import { parseIsoDate } from "./dates";
import { Attention, RowReader } from "./reader";
import type { MapContext, MapResult, MappedTransaction } from "./types";

/**
 * Cdiscount's invoice and credit-note list.
 *
 * Refunds are written in accounting notation — `(39.99)` — which the shared
 * number parser reads as negative. Legacy took the absolute value here, so
 * refunds landed positive and inflated the totals; the agreed rule is that a
 * refund is negative in every channel, and this is where that starts.
 */
export function mapCdiscount({ grid, headerRowIndex }: MapContext): MapResult {
  const reader = new RowReader(grid, headerRowIndex, ".");
  const rows: MappedTransaction[] = [];

  for (let rowIndex = reader.firstDataRow; rowIndex < reader.rowCount; rowIndex += 1) {
    if (reader.isBlank(rowIndex)) continue;

    const attention = new Attention();

    const gross = attention.take(reader.decimal(rowIndex, "Gross amount"));
    const net = attention.take(reader.decimal(rowIndex, "Net amount"));
    const vat = attention.take(reader.decimal(rowIndex, "VAT amount"));
    const occurredOn = parseIsoDate(reader.text(rowIndex, "Accounting date"));

    if (occurredOn === null) attention.add("Не удалось определить дату учёта.");

    rows.push({
      sourceRowNumber: rowIndex + 1,
      dataset: "cdiscount",
      channel: "cdiscount",
      countryCode: "FR",

      naturalKey: reader.text(rowIndex, "Invoice/Refund Id"),
      occurredOn,
      transactionType: reader.text(rowIndex, "Invoice type") ?? reader.text(rowIndex, "Operation"),

      currency: reader.text(rowIndex, "Currency") ?? "EUR",
      gross,
      vatAmount: vat,
      netAmount: net,
      vatRate: null,

      departureCountry: null,
      arrivalCountry: "FR",
      sellerVatNumber: null,
      buyerVatNumber: null,
      taxScheme: null,

      sku: null,
      quantity: null,

      needsAttention: attention.needsAttention,
      attentionReason: attention.reason,
      raw: reader.raw(rowIndex),
    });
  }

  return { rows, missingColumns: reader.missingColumns };
}
