import type Decimal from "decimal.js";

import type { Grid } from "@/lib/ingest/classify";
import type { SimpleDataset } from "@/lib/ingest/datasets";

import { classifySimpleChannel } from "./toolkit";
import type { ChannelModule } from "./types";

import { parseAllegroTimestamp } from "@/lib/ingest/mappers/dates";
import { Attention, RowReader } from "@/lib/ingest/mappers/reader";
import type { MapContext, MapResult, MappedTransaction } from "@/lib/ingest/mappers/types";
import { NumberFormatError, parseDecimalValue } from "@/lib/ingest/numbers";

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
    // Read once: currency and amount both come from the same cell, and
    // `parseAllegroAmount` needs the identifier `currencyOf` finds to know
    // what to strip before handing the rest to the decimal parser.
    const kwota = reader.text(rowIndex, "kwota");
    const amount = attention.take(parseAllegroAmount(kwota));
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

      currency: currencyOf(kwota),
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
 * Symbols Allegro has written so far, normalised to their ISO code. Kept
 * separate from the currency_map channel rule: this is about reading the
 * file (what does "zł" mean), while currency_map is about the business
 * (what does PLN imply) — a tenant can edit the second without breaking the
 * first.
 */
const KNOWN_ALLEGRO_SYMBOLS: Record<string, string> = {
  "zł": "PLN",
  Ft: "HUF",
  "Kč": "CZK",
  "€": "EUR",
};

/**
 * Allegro always writes an identifier right after the amount — a symbol
 * (`zł`, `Kč`) or a bare ISO code. A known one normalises to its code; one
 * this file has never carried before still parses into a stable string
 * (upper-cased, whatever script it is written in) instead of `null` — the
 * currency_map gate is what asks a human to decide what it means, not this
 * function.
 */
function currencyOf(raw: string | null): string | null {
  if (!raw) return null;

  const token = trailingIdentifier(raw);

  if (!token) return null;

  const lower = token.toLowerCase();
  const known = Object.entries(KNOWN_ALLEGRO_SYMBOLS).find(
    ([symbol]) => symbol.toLowerCase() === lower,
  );

  return known ? known[1] : token.toUpperCase();
}

/** The non-numeric suffix written after the amount, whatever it is. */
function trailingIdentifier(raw: string): string | null {
  const match = raw.trim().match(/[\d)]\s*([^\d\s.,()+-]+)\s*$/);

  return match ? match[1] : null;
}

/**
 * `parseDecimalValue` only strips a fixed list of currency tokens it already
 * knows about — a symbol this file has never carried before would otherwise
 * be left in the string and fail to parse as a number at all, flagging a
 * perfectly good amount as unreadable. The identifier is cut off first, here,
 * so the currency written next to the amount can never make the amount
 * itself unreadable.
 *
 * Exported: `kwota` is not the only column with a currency stuck to the
 * amount — `dostawa` (delivery) does too, and the Allegro invoice report
 * reads that one straight out of the raw row rather than through the ledger.
 * One parser, so both read the identifier the same way.
 */
export function parseAllegroMoney(raw: string | null, column = "kwota"): Decimal | null {
  if (raw === null) return null;

  const token = trailingIdentifier(raw);
  const numeric = token ? raw.slice(0, raw.length - token.length) : raw;

  return parseDecimalValue(numeric, { decimalSeparator: ".", column });
}

function parseAllegroAmount(raw: string | null): { value: Decimal | null } | { error: string } {
  try {
    return { value: parseAllegroMoney(raw) };
  } catch (error) {
    if (error instanceof NumberFormatError) return { error: error.message };

    throw error;
  }
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
