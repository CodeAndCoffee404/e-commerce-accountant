import type { Grid } from "@/lib/ingest/classify";
import type { DatasetId, DatasetVariants, SimpleDataset } from "@/lib/ingest/datasets";

import { classifySimpleChannel } from "./toolkit";
import type { ChannelModule, ChannelRuleSeed } from "./types";

import Decimal from "decimal.js";

import { parseIsoDate } from "@/lib/ingest/mappers/dates";
import { wholeUnitsProblem } from "@/lib/ingest/numbers";
import { Attention, RowReader } from "@/lib/ingest/mappers/reader";
import type { MapContext, MapResult, MappedTransaction } from "@/lib/ingest/mappers/types";

/**
 * One Shopify shop: the dataset its rows are filed under and where its goods
 * leave from.
 *
 * There are two shops on the same Shopify account and their exports have the
 * same columns to the letter, so the shop is not something a row can be
 * asked for — it is decided once, at classification, and everything after
 * that is told which shop it is working for.
 */
type ShopifyStore = {
  dataset: Extract<DatasetId, `shopify_${string}`>;
  label: string;
  /**
   * Where the goods leave from, when that is an agreed rule for the shop.
   * Null means no rule has been agreed and the ledger says so rather than
   * inventing one.
   */
  departureCountry: string | null;
};

const GEYSER: ShopifyStore = {
  dataset: "shopify_geyser",
  // Kept identical to legacy: it is what the report registry matches on.
  label: "Geyser shopify sales report",
  // An agreed rule (PLAN §1).
  departureCountry: "ES",
};

const WATERLIFT: ShopifyStore = {
  dataset: "shopify_waterlift",
  label: "Waterlift shopify sales report",
  departureCountry: null,
};

/**
 * Shopify's order export. One order spans several rows — the first carries the
 * order totals, the rest only line items — so order-level columns are empty on
 * continuation rows and are carried down.
 *
 * Swiss orders are dropped when a report is built, not here: the ledger
 * records what the file said.
 */
export function mapShopify(store: ShopifyStore, { grid, headerRowIndex }: MapContext): MapResult {
  const reader = new RowReader(grid, headerRowIndex, ".");
  const rows: MappedTransaction[] = [];

  let currentOrder: string | null = null;
  let currentCurrency: string | null = null;
  let currentCountry: string | null = null;
  let currentDate: string | null = null;

  for (let rowIndex = reader.firstDataRow; rowIndex < reader.rowCount; rowIndex += 1) {
    if (reader.isBlank(rowIndex)) continue;

    const attention = new Attention();

    const orderName = reader.text(rowIndex, "Name");
    const isFirstRowOfOrder = orderName !== null && orderName !== currentOrder;

    if (isFirstRowOfOrder) {
      currentOrder = orderName;
      currentCurrency = reader.text(rowIndex, "Currency");
      currentCountry =
        reader.text(rowIndex, "Shipping Country") ?? reader.text(rowIndex, "Billing Country");
      currentDate = parseIsoDate(reader.text(rowIndex, "Created at"));
    }

    if (currentDate === null) attention.add("The order date could not be read.");

    const price = attention.take(reader.decimal(rowIndex, "Lineitem price"));
    const quantity = attention.take(reader.decimal(rowIndex, "Lineitem quantity"));
    const discount = attention.take(reader.decimal(rowIndex, "Lineitem discount"));

    attention.add(wholeUnitsProblem(quantity, "Lineitem quantity"));

    // Line gross is price × quantity less the line discount. Shopify does not
    // ship that product, and computing it here keeps the ledger row
    // self-contained instead of leaving a total only the order header knows.
    const gross =
      price === null || quantity === null
        ? null
        : price.times(quantity).minus(discount ?? new Decimal(0));

    rows.push({
      sourceRowNumber: rowIndex + 1,
      dataset: store.dataset,
      channel: store.dataset,
      countryCode: currentCountry,

      naturalKey: [reader.text(rowIndex, "Id"), reader.text(rowIndex, "Lineitem sku")]
        .filter(Boolean)
        .join("/") || null,
      occurredOn: currentDate,
      transactionType: reader.text(rowIndex, "Financial Status"),

      currency: currentCurrency,
      gross,
      // Taxes are reported per order, not per line, so attributing them to a
      // line here would double-count on multi-item orders.
      vatAmount: isFirstRowOfOrder ? attention.take(reader.decimal(rowIndex, "Taxes")) : null,
      netAmount: null,
      vatRate: null,

      departureCountry: store.departureCountry,
      arrivalCountry: currentCountry,
      sellerVatNumber: null,
      buyerVatNumber: null,
      taxScheme: null,

      sku: reader.text(rowIndex, "Lineitem sku"),
      quantity,

      needsAttention: attention.needsAttention,
      attentionReason: attention.reason,
      raw: reader.raw(rowIndex),
    });
  }

  return { rows, missingColumns: reader.missingColumns };
}

/**
 * Both shops export this, character for character — same columns, same order.
 * The layout therefore says "Shopify" and nothing more; which shop is a
 * separate question, answered below.
 */
const PROFILE: SimpleDataset = {
  id: GEYSER.dataset,
  label: GEYSER.label,
  headerRowIndex: 0,
  requiredHeaders: [
    "Name",
    "Email",
    "Financial Status",
    "Paid at",
    "Fulfillment Status",
    "Created at",
  ],
  periodResolver: "shopify",
  periodColumn: "Created at",
};

/**
 * Which shop an export came from.
 *
 * Nothing in the file names the shop, so this reads the two things that
 * differ by construction rather than by chance: the shop's currency and
 * where its customers are billed. Each row votes with both, values nobody
 * recognises abstain, and a clear majority wins.
 *
 * What is deliberately *not* used: the order number (Geyser's counter is six
 * digits and Waterlift's seven — until Geyser's rolls over), the file name
 * (renamed by hand as often as not), and the vendor stamped on the product
 * (free text, edited in the shop's admin, and already wrong on the products
 * the two shops share). All three would work today and fail quietly later,
 * and the failure would be an invoice issued by the wrong company.
 *
 * The threshold is a real check, not a formality: an order billed abroad is
 * ordinary in either shop, so a handful of rows can look like either one and
 * only the file as a whole is conclusive.
 */
const EUROPE = [
  "AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GR", "HR",
  "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MC", "MT", "NL", "NO", "PL", "PT", "RO",
  "SE", "SI", "SK", "UK",
];

const VARIANTS: DatasetVariants = {
  members: [
    { id: GEYSER.dataset, label: GEYSER.label },
    { id: WATERLIFT.dataset, label: WATERLIFT.label },
  ],
  signals: [
    {
      column: "Currency",
      votes: { EUR: GEYSER.dataset, USD: WATERLIFT.dataset },
    },
    {
      column: "Billing Country",
      votes: {
        US: WATERLIFT.dataset,
        ...Object.fromEntries(EUROPE.map((country) => [country, GEYSER.dataset])),
      },
    },
  ],
  // Nine votes in, and nine in ten of them agreeing. A whole month of orders
  // casts hundreds, so this only ever bites on a file too small or too mixed
  // to be a month of one shop's sales.
  majority: 0.9,
  minimumVotes: 9,
};

/**
 * The rules a shop cannot be read without. They are per shop, not per
 * platform: the two sell under different companies, in different currencies,
 * under different tax regimes, and a rule that leaked from one to the other
 * would be wrong in a way no warning would catch.
 */
const GEYSER_RULES: readonly ChannelRuleSeed[] = [
  {
    channel: GEYSER.dataset,
    key: "defaults",
    value: {
      departureCountry: "ES",
      domesticScheme: "REGULAR",
      domesticSellerVat: "ESN0531416F",
      exportScheme: "UNION-OSS",
      exportSellerVat: "EE102013089",
    },
    note: "Always ships from Spain; REGULAR within Spain, UNION-OSS otherwise.",
  },
  {
    channel: GEYSER.dataset,
    key: "skipped_arrival_countries",
    value: ["CH"],
    note: "Orders to Switzerland stay out of the report — an agreed rule.",
  },
  {
    channel: GEYSER.dataset,
    key: "country_aliases",
    value: { UK: "GB" },
    note: "Shopify writes UK; reporting needs GB.",
  },
  {
    channel: GEYSER.dataset,
    key: "recompute_zero_tax_countries",
    value: ["GB"],
    note:
      "British orders arrive with zero tax and no rate in the label, so the VAT " +
      "is computed from the order total. Elsewhere a zero means zero and must " +
      "not be filled in.",
  },
  {
    channel: GEYSER.dataset,
    key: "excluded_sources",
    value: ["shopify_draft_order"],
    note: "Draft orders are not sales.",
  },
];

/**
 * One module per shop. They share a layout, a mapper and a period, and differ
 * in the only two things that matter: which dataset the rows land in and
 * which rules are read for them.
 *
 * Classification is a family affair — the vote is over the whole file — so a
 * module hands the file on with null when the file turns out to be the other
 * shop's, and passes a refusal through when the file is neither.
 */
function shopifyModuleFor(store: ShopifyStore, rules: readonly ChannelRuleSeed[]): ChannelModule {
  return {
    id: store.dataset,
    shortName: store.dataset === GEYSER.dataset ? "Shopify Geyser" : "Shopify Waterlift",
    classify: (grid: Grid) => {
      const result = classifySimpleChannel(PROFILE, grid, VARIANTS);

      if (result?.ok && result.dataset !== store.dataset) return null;

      return result;
    },
    map: (context: MapContext) => mapShopify(store, context),
    defaultRules: rules,
  };
}

export const shopifyGeyserModule = shopifyModuleFor(GEYSER, GEYSER_RULES);

/**
 * The second shop. Its orders are read and kept, and no report reads them
 * yet: it sells in dollars into US states, which is a different tax question
 * from anything this system answers today. Filing them separately is what
 * makes that a decision to be taken later rather than a silent error now.
 */
export const shopifyWaterliftModule = shopifyModuleFor(WATERLIFT, []);
