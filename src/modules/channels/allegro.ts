import type { Grid } from "@/lib/ingest/classify";
import type { SimpleDataset } from "@/lib/ingest/datasets";

import { classifySimpleChannel } from "./toolkit";
import type { ChannelModule } from "./types";

import { parseAllegroTimestamp } from "@/lib/ingest/mappers/dates";
import { Attention, RowReader } from "@/lib/ingest/mappers/reader";
import type { MapContext, MapResult, MappedTransaction } from "@/lib/ingest/mappers/types";

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

    if (occurredOn === null) attention.add("The operation date could not be read.");

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

const PROFILE: SimpleDataset = {
  id: "allegro",
  label: "Allegro sales report",
  headerRowIndex: 0,
  requiredHeaders: ["data", "data zaksięgowania", "identyfikator", "operacja", "operator"],
  periodResolver: "allegro",
  periodColumn: "data",
};

export const ALLEGRO_CURRENCY_MAP = {
  PLN: { country: "PL", scheme: "REGULAR", sellerVat: "PL5263307678" },
  CZK: { country: "CZ", scheme: "UNION-OSS", sellerVat: "EE102013089" },
  EUR: { country: "SK", scheme: "UNION-OSS", sellerVat: "EE102013089" },
  HUF: { country: "HU", scheme: "UNION-OSS", sellerVat: "EE102013089" },
} as const;

export const allegroModule: ChannelModule = {
  id: "allegro",
  shortName: "Allegro",
  classify: (grid: Grid) => classifySimpleChannel(PROFILE, grid),
  map: mapAllegro,
  defaultRules: [
    {
      channel: "allegro",
      key: "currency_map",
      value: ALLEGRO_CURRENCY_MAP,
      note: "The currency decides the arrival country, the rate and the seller VAT number.",
    },
    {
      channel: "allegro",
      key: "departure_country",
      value: "PL",
      note: "Always ships from Poland.",
    },
    {
      channel: "allegro",
      key: "operation_types",
      value: { wpłata: "B2C SALE", zwrot: "REFUND" },
      note: "Anything else is an Allegro fee and does not belong in the report.",
    },
  ],
};
