import { parseAllegroTimestamp } from "./dates";
import { Attention, RowReader } from "./reader";
import type { MapContext, MapResult, MappedTransaction } from "./types";

/**
 * Allegro's account statement. Every line is a money movement — a sale, a fee,
 * a refund — and `kwota` already carries its own sign, which is the convention
 * the ledger uses everywhere.
 *
 * Despite the Polish headers the amounts use a dot: `-24.59 zł`. Assuming the
 * decimal comma a Polish locale would suggest turns 24.59 into 2459.
 */
export function mapAllegro({ grid, headerRowIndex, period }: MapContext): MapResult {
  const reader = new RowReader(grid, headerRowIndex, ".");
  const rows: MappedTransaction[] = [];

  for (let rowIndex = reader.firstDataRow; rowIndex < reader.rowCount; rowIndex += 1) {
    if (reader.isBlank(rowIndex)) continue;

    const attention = new Attention();
    const amount = attention.take(reader.decimal(rowIndex, "kwota"));
    const occurredOn = parseAllegroTimestamp(reader.text(rowIndex, "data"));

    if (occurredOn === null) attention.add("Не удалось определить дату операции.");

    rows.push({
      sourceRowNumber: rowIndex + 1,
      dataset: "allegro",
      channel: "allegro",
      // Sales settled in EUR are treated as delivered to Slovakia — an agreed
      // rule, see the calculation table in PLAN §1. The rule is applied when a
      // report is built, not here: the ledger keeps what the file said.
      countryCode: "PL",

      naturalKey: reader.text(rowIndex, "identyfikator"),
      occurredOn,
      transactionType: reader.text(rowIndex, "operacja"),

      currency: currencyOf(reader.text(rowIndex, "kwota")),
      // A statement line is a single amount. Splitting it into net and VAT
      // needs the rate reference, which belongs to a later stage.
      gross: amount,
      vatAmount: null,
      netAmount: null,
      vatRate: null,

      departureCountry: null,
      arrivalCountry: null,
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

  void period;

  return { rows, missingColumns: reader.missingColumns };
}

/**
 * Allegro writes the currency next to the amount rather than in a column, and
 * settles in five of them across the corpus.
 */
function currencyOf(raw: string | null): string | null {
  if (!raw) return null;
  if (/zł/i.test(raw)) return "PLN";
  if (/Ft|HUF/i.test(raw)) return "HUF";
  if (/Kč|CZK/i.test(raw)) return "CZK";
  if (/€|EUR/i.test(raw)) return "EUR";

  return null;
}
