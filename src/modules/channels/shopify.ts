import type { Grid } from "@/lib/ingest/classify";
import type { SimpleDataset } from "@/lib/ingest/datasets";

import { classifySimpleChannel } from "./toolkit";
import type { ChannelModule } from "./types";

import Decimal from "decimal.js";

import { parseIsoDate } from "@/lib/ingest/mappers/dates";
import { wholeUnitsProblem } from "@/lib/ingest/numbers";
import { Attention, RowReader } from "@/lib/ingest/mappers/reader";
import type { MapContext, MapResult, MappedTransaction } from "@/lib/ingest/mappers/types";

/**
 * Shopify's order export. One order spans several rows — the first carries the
 * order totals, the rest only line items — so order-level columns are empty on
 * continuation rows and are carried down.
 *
 * Departure is always ES, an agreed rule (PLAN §1). Swiss orders are dropped
 * when a report is built, not here: the ledger records what the file said.
 */
export function mapShopify({ grid, headerRowIndex }: MapContext): MapResult {
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
      dataset: "shopify",
      channel: "shopify",
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

      departureCountry: "ES",
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

const PROFILE: SimpleDataset = {
  id: "shopify",
  label: "Geyser shopify sales report",
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

export const shopifyModule: ChannelModule = {
  id: "shopify",
  shortName: "Shopify",
  classify: (grid: Grid) => classifySimpleChannel(PROFILE, grid),
  map: mapShopify,
  defaultRules: [
    {
      channel: "shopify",
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
      channel: "shopify",
      key: "skipped_arrival_countries",
      value: ["CH"],
      note: "Orders to Switzerland stay out of the report — an agreed rule.",
    },
    {
      channel: "shopify",
      key: "country_aliases",
      value: { UK: "GB" },
      note: "Shopify writes UK; reporting needs GB.",
    },
    {
      channel: "shopify",
      key: "recompute_zero_tax_countries",
      value: ["GB"],
      note:
        "British orders arrive with zero tax and no rate in the label, so the VAT " +
        "is computed from the order total. Elsewhere a zero means zero and must " +
        "not be filled in.",
    },
    {
      channel: "shopify",
      key: "excluded_sources",
      value: ["shopify_draft_order"],
      note: "Draft orders are not sales.",
    },
  ],
};
