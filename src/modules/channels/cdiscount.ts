import type { Grid } from "@/lib/ingest/classify";
import type { SimpleDataset } from "@/lib/ingest/datasets";

import { classifySimpleChannel } from "./toolkit";
import type { ChannelModule } from "./types";

import { parseIsoDate } from "@/lib/ingest/mappers/dates";
import { Attention, RowReader } from "@/lib/ingest/mappers/reader";
import type { MapContext, MapResult, MappedTransaction } from "@/lib/ingest/mappers/types";

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

    if (occurredOn === null) attention.add("The accounting date could not be read.");

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

const PROFILE: SimpleDataset = {
  id: "cdiscount",
  label: "Cdiscount sales report",
  headerRowIndex: 2,
  requiredHeaders: ["Sales channel", "Shop Id", "Invoice/Refund Id", "Accounting date"],
  periodResolver: "cdiscount",
  periodColumn: "Accounting date",
};

export const cdiscountModule: ChannelModule = {
  id: "cdiscount",
  shortName: "Cdiscount",
  classify: (grid: Grid) => classifySimpleChannel(PROFILE, grid),
  map: mapCdiscount,
  defaultRules: [
    {
      channel: "cdiscount",
      key: "defaults",
      value: {
        currency: "EUR",
        departureCountry: "FR",
        arrivalCountry: "FR",
        scheme: "REGULAR",
      },
      note: "Cdiscount sells in France only.",
    },
    {
      channel: "cdiscount",
      key: "invoice_types",
      value: { Vente: "B2C SALE", "Remboursement client": "REFUND" },
      note: "Subscriptions and commission credits are not sales.",
    },
  ],
};
