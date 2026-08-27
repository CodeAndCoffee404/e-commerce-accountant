import type { Grid } from "@/lib/ingest/classify";
import type { SimpleDataset } from "@/lib/ingest/datasets";

import { classifySimpleChannel } from "./toolkit";
import type { ChannelModule } from "./types";

import { parseIsoDate } from "@/lib/ingest/mappers/dates";
import { Attention, RowReader } from "@/lib/ingest/mappers/reader";
import type { MapContext, MapResult, MappedTransaction } from "@/lib/ingest/mappers/types";
import { wholeUnitsProblem } from "@/lib/ingest/numbers";

/**
 * Cdiscount's order extract — one row per order line, unlike the invoice
 * report's one row per accounting movement. It carries a three-row preamble
 * (seller id, the period it was exported for, the export timestamp) above
 * the header, which is why the header sits at a fixed row rather than row 0
 * like most other channels — the same shape the invoice report uses, just a
 * different row.
 *
 * `Total price (VAT incl.)` is already the line total (unit price × quantity),
 * not a per-unit price — legacy never split it further, so neither does this.
 */
export function mapCdiscountOrders({ grid, headerRowIndex }: MapContext): MapResult {
  const reader = new RowReader(grid, headerRowIndex, ".");
  const rows: MappedTransaction[] = [];

  for (let rowIndex = reader.firstDataRow; rowIndex < reader.rowCount; rowIndex += 1) {
    if (reader.isBlank(rowIndex)) continue;

    const attention = new Attention();

    const gross = attention.take(reader.decimal(rowIndex, "Total price (VAT incl.)"));
    const quantity = attention.take(reader.decimal(rowIndex, "Quantity"));

    attention.add(wholeUnitsProblem(quantity, "Quantity"));

    const occurredOn = parseIsoDate(reader.text(rowIndex, "Order date (UTC)"));

    if (occurredOn === null) attention.add("The order date could not be read.");

    // The file writes country codes lower-case ("Fr"); every other channel
    // stores them upper-case, and mixing the two would split one country
    // into two chips wherever transactions are grouped by it.
    const arrivalCountry = reader.text(rowIndex, "Delivery Country")?.toUpperCase() ?? "FR";

    rows.push({
      sourceRowNumber: rowIndex + 1,
      dataset: "cdiscount_orders",
      channel: "cdiscount",
      countryCode: arrivalCountry,

      naturalKey:
        [reader.text(rowIndex, "Order Number"), reader.text(rowIndex, "SKU")]
          .filter(Boolean)
          .join("/") || null,
      occurredOn,
      transactionType: reader.text(rowIndex, "Order status"),

      currency: reader.text(rowIndex, "Currency") ?? "EUR",
      gross,
      vatAmount: null,
      netAmount: null,
      vatRate: null,

      departureCountry: null,
      arrivalCountry,
      sellerVatNumber: null,
      buyerVatNumber: null,
      taxScheme: null,

      sku: reader.text(rowIndex, "SKU"),
      quantity,

      needsAttention: attention.needsAttention,
      attentionReason: attention.reason,
      raw: reader.raw(rowIndex),
    });
  }

  return { rows, missingColumns: reader.missingColumns };
}

const PROFILE: SimpleDataset = {
  id: "cdiscount_orders",
  label: "Cdiscount orders report",
  headerRowIndex: 5,
  requiredHeaders: [
    "Sales Channel",
    "Order Number",
    "Order date (UTC)",
    "Order status",
    "SKU",
    "Quantity",
  ],
  periodResolver: "cdiscount_orders",
  periodColumn: "Order date (UTC)",
};

export const cdiscountOrdersModule: ChannelModule = {
  id: "cdiscount_orders",
  shortName: "Cdiscount Orders",
  classify: (grid: Grid) => classifySimpleChannel(PROFILE, grid),
  map: mapCdiscountOrders,
  // Shares the "cdiscount" channel_rules bucket the invoice report already
  // seeds (currency, France as the default arrival country) — nothing here
  // needs a rule of its own yet.
  defaultRules: [],
};
