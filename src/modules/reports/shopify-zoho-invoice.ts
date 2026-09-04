import Decimal from "decimal.js";

import { parseDecimalValue } from "@/lib/ingest/numbers";

import { exactLines } from "@/lib/reports/invoice-lines";
import { channelRule, decideSku, splitGross, vatRateOn } from "@/lib/reports/rules";
import type {
  GeneratorResult,
  LedgerRow,
  ReportContext,
  ReportSheet,
  RulesSnapshot,
} from "@/lib/reports/types";

import { ZOHO_HEADERS } from "./amazon-zoho-invoice";
import { parseShopifyTaxRate } from "./off-amazon-sales";
import type { ReportModule, UnmappedSku } from "./types";

/**
 * Shopify invoice for Zoho: one line per item sold, plus VAT split by market.
 *
 * Off-Amazon Sales reads Shopify as one row per *order* — the order total,
 * taken from the first line's order-level columns, with the rest of that
 * order's lines skipped as mere continuations. This invoice needs the
 * opposite grain: every `LedgerRow` Shopify produces is already one line
 * item (`mapShopify` writes one per `Lineitem`, first row of an order
 * included), so the product side of this module reads all of them.
 *
 * VAT stays order-level, because Shopify only reports `Taxes` once per
 * order, on that first line — so the VAT pass below still reads only the
 * rows that carry an order `Total`, exactly as `shopifyRow` does.
 *
 * A single order's other columns (`Source`, used to drop draft orders) are
 * likewise only written on that first line, but every one of an order's
 * lines has to be excluded together — so `orderSourceMap` below resolves
 * each order's `Source` once, up front, and every row looks it up by order
 * number rather than trusting its own (possibly blank) `raw["Source"]`.
 */

/**
 * What a line item is, as far as SKU mapping is concerned.
 *
 * Shopify writes `Lineitem sku` when the product has one and leaves it blank
 * when it does not — 51 of July's 72 lines carried one — so the code alone
 * cannot be the key for every line. Where there is a code it is the key and
 * the name checks it; where there is none the name is the key, and a mapping
 * row for it stores the same text in both columns.
 *
 * Both passes below identify a line through this, so `unmappedSkus` asks
 * about exactly the lines `generate` would otherwise get wrong.
 */
function identify(row: LedgerRow): { key: string; name: string } | null {
  const name = row.raw["Lineitem name"]?.trim() ?? "";
  const code = row.sku?.trim() ?? "";
  const key = code === "" ? name : code;

  return key === "" ? null : { key, name };
}

type ShopifyDefaults = {
  departureCountry: string;
  domesticScheme: string;
  domesticSellerVat: string;
  exportScheme: string;
  exportSellerVat: string;
};

/**
 * The four export markets big enough for their own Zoho ledger line.
 * Everything else pools into "VAT OSS Other countries" — a fixed list, not a
 * setting, by agreement (see the ТЗ discussion): it does not grow on its own
 * just because a new country shows up in a file.
 */
const OSS_BREAKOUT_COUNTRIES = ["DE", "FR", "IT", "PL"];

const VAT_BUCKET_ORDER = ["ES", "DE", "FR", "IT", "PL", "OTHER"] as const;

/**
 * The names of the Zoho accounts these lines post to, not labels: country in
 * the middle, scheme last, that capitalisation — the same shape the Amazon and
 * Allegro invoices use, so one country's tax lands on one account whichever
 * channel sold it. The pooled line has no country to place and keeps the name
 * all three share.
 */
const VAT_BUCKET_LABELS: Record<string, string> = {
  ES: "VAT ES Regular",
  DE: "VAT DE OSS",
  FR: "VAT FR OSS",
  IT: "VAT IT OSS",
  PL: "VAT PL OSS",
  OTHER: "VAT OSS Other countries",
};

function arrivalCountryOf(row: LedgerRow, rules: RulesSnapshot): string {
  const aliases = channelRule<Record<string, string>>(rules, "shopify_geyser", "country_aliases") ?? {};
  const raw = row.raw["Shipping Country"] || row.raw["Billing Country"] || row.countryCode || "";

  return aliases[raw] ?? raw;
}

/**
 * Which VAT ledger line an order's country falls under: Spain's own domestic
 * line, one of the four breakout markets, or the shared "other" bucket. Not
 * the grouping a legacy-built invoice once used (Austria filed under "DE",
 * Slovenia under "FR") — that was confirmed to be a manual mistake, not a
 * rule, and is not reproduced here.
 */
function vatBucketKey(arrival: string, departure: string): string {
  if (arrival === departure) return "ES";

  return OSS_BREAKOUT_COUNTRIES.includes(arrival) ? arrival : "OTHER";
}

/** Every order's `Source`, resolved once from whichever of its lines carries it. */
function orderSourceMap(rows: readonly LedgerRow[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const row of rows) {
    if (row.dataset !== "shopify_geyser") continue;

    const name = row.raw["Name"];
    const source = row.raw["Source"];

    if (name && source) map.set(name, source);
  }

  return map;
}

function isExcludedRow(
  row: LedgerRow,
  rules: RulesSnapshot,
  sources: ReadonlyMap<string, string>,
  arrival: string,
): string | null {
  const excludedSources = channelRule<string[]>(rules, "shopify_geyser", "excluded_sources") ?? [];
  const source = sources.get(row.raw["Name"] ?? "") ?? "";

  if (excludedSources.includes(source)) return "Shopify invoice: draft order";

  const skippedCountries = channelRule<string[]>(rules, "shopify_geyser", "skipped_arrival_countries") ?? [];

  if (skippedCountries.includes(arrival)) return `Shopify invoice: delivered to ${arrival}`;

  return null;
}

/** `INV-GeyserWebsite-01.26` — the client's own numbering, taken from a real invoice. */
function invoiceNumber(periodEnd: string): string {
  const [year, month] = periodEnd.split("-");

  return `INV-GeyserWebsite-${month}.${year.slice(2)}`;
}

type ProductLine = {
  itemName: string;
  sku: string;
  qty: Decimal;
  unitPrice: Decimal;
  /** What these rows came to in the ledger — see `exactLines`. */
  total: Decimal;
};

export function generateShopifyZohoInvoice(
  rows: readonly LedgerRow[],
  context: ReportContext,
): GeneratorResult {
  const skipped = new Map<string, number>();
  const warnings: string[] = [];

  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  const defaults = channelRule<ShopifyDefaults>(context.rules, "shopify_geyser", "defaults");

  if (!defaults) {
    // Every figure below depends on it — departure country decides the whole
    // VAT split. Refuse rather than build a invoice that silently bucketed
    // everything as "Other countries".
    throw new Error(
      "Shopify invoice: the shopify/defaults channel rule is missing. Settings -> Channel rules -> " +
        "Restore missing defaults, then build again.",
    );
  }

  const sources = orderSourceMap(rows);

  /* ------------------------------------------------------------------ *
   * Product lines: every line item, one row per (item, unit price).
   * ------------------------------------------------------------------ */

  const productAgg = new Map<string, ProductLine>();

  for (const row of rows) {
    if (row.dataset !== "shopify_geyser") continue;

    const arrival = arrivalCountryOf(row, context.rules);
    const excludeReason = isExcludedRow(row, context.rules, sources, arrival);

    if (excludeReason) {
      skip(excludeReason);
      continue;
    }

    const item = identify(row);

    if (!item) {
      warnings.push(
        `Shopify invoice: a line item with neither a SKU nor a name, row ${row.sourceRowNumber}`,
      );
      skip("Shopify invoice: line item has neither a SKU nor a name");
      continue;
    }

    if (row.gross === null) {
      skip("Shopify invoice: line amount could not be read");
      continue;
    }

    const quantity = row.quantity;

    if (quantity === null || quantity.isZero()) {
      skip("Shopify invoice: no quantity");
      continue;
    }

    const decision = decideSku(context.rules, "shopify_geyser", item.key, item.name);

    if (decision.kind === "ignore") {
      skip("Shopify invoice: item is on the ignore list");
      continue;
    }

    // Unreachable in a normal build — `unmappedSkus` stops the run and asks
    // first — but if it is ever reached, a mapping that disagrees about what
    // the code is must not decide what to bill. Left visible rather than
    // dropped quietly.
    if (decision.kind === "mismatch") {
      warnings.push(
        `Shopify invoice: ${item.key} arrived as "${item.name}", but SKU mapping expects ` +
          `${decision.expectedNames.map((expected) => `"${expected}"`).join(" or ")}`,
      );
      skip("Shopify invoice: the mapping disagrees about what this SKU is");
      continue;
    }

    // Grouped by the exact unit price, not the rounded one — two sales at
    // genuinely different prices are two invoice lines, same reasoning as
    // the Amazon invoice.
    const unitPrice = row.gross.dividedBy(quantity);
    const sku = decision.kind === "map" ? decision.targetSku : item.key;
    const itemName = decision.kind === "map" ? decision.itemName : "";
    const key = `${sku}|${unitPrice.toFixed(10)}`;
    const existing = productAgg.get(key);

    if (existing) {
      existing.qty = existing.qty.plus(quantity);
      existing.total = existing.total.plus(row.gross);
    } else productAgg.set(key, { itemName, sku, qty: quantity, unitPrice, total: row.gross });
  }

  /* ------------------------------------------------------------------ *
   * VAT lines: one order = one Taxes figure, read once per order.
   * ------------------------------------------------------------------ */

  const vatAgg = new Map<string, Decimal>();
  const recompute =
    channelRule<string[]>(context.rules, "shopify_geyser", "recompute_zero_tax_countries") ?? [];

  for (const row of rows) {
    if (row.dataset !== "shopify_geyser") continue;

    const orderTotal = row.raw["Total"];

    if (!orderTotal) continue; // a continuation line — the order total lives on the first row

    const arrival = arrivalCountryOf(row, context.rules);
    const excludeReason = isExcludedRow(row, context.rules, sources, arrival);

    // Already tallied in `skipped` above, once per line, in the product
    // pass — this is the same order's first line, not a new row to count.
    if (excludeReason) continue;

    if (row.occurredOn === null) {
      warnings.push(`Shopify invoice: order date could not be read, row ${row.sourceRowNumber}`);
      skip("Shopify invoice: order date could not be read");
      continue;
    }

    let total: Decimal | null;

    try {
      total = parseDecimalValue(orderTotal, { decimalSeparator: ".", column: "Total" });
    } catch {
      total = null;
    }

    if (total === null) {
      warnings.push(
        `Shopify invoice: order total "${orderTotal}" could not be read, row ${row.sourceRowNumber}`,
      );
      skip("Shopify invoice: order total could not be read");
      continue;
    }

    // Same read as Off-Amazon Sales: trust the tax Shopify already charged
    // and the buyer's own invoice shows, except in the countries where a
    // reported zero is known to be wrong and has to be recomputed from the
    // rate instead.
    const labelled = parseShopifyTaxRate(row.raw["Tax 1 Name"]);
    const fallbackRate = vatRateOn(context.rules, arrival, row.occurredOn);
    const rate = labelled ?? fallbackRate;

    const reported = row.raw["Taxes"];
    let reportedVat: Decimal | null = null;

    try {
      reportedVat = parseDecimalValue(reported, { decimalSeparator: ".", column: "Taxes" });
    } catch {
      warnings.push(`Shopify invoice: tax "${reported}" could not be read, row ${row.sourceRowNumber}`);
    }

    const computedVat = rate === null ? null : splitGross(total, rate).vat;
    const vat =
      reportedVat === null || (reportedVat.isZero() && recompute.includes(arrival))
        ? computedVat
        : reportedVat;

    if (vat === null) {
      warnings.push(`Shopify invoice: no VAT rate for ${arrival}, row ${row.sourceRowNumber}`);
      skip(`Shopify invoice: no VAT rate for ${arrival}`);
      continue;
    }

    const bucket = vatBucketKey(arrival, defaults.departureCountry);

    vatAgg.set(bucket, (vatAgg.get(bucket) ?? new Decimal(0)).plus(vat));
  }

  /* ------------------------------------------------------------------ *
   * Assemble the sheet.
   * ------------------------------------------------------------------ */

  const invoiceDate = `${context.period.end} 00:00:00`;
  const invoiceNo = invoiceNumber(context.period.end);
  const output: (string | number | null)[][] = [];

  const productRows = [...productAgg.values()].sort((a, b) => {
    const bySku = a.sku.localeCompare(b.sku);

    return bySku !== 0 ? bySku : a.unitPrice.comparedTo(b.unitPrice);
  });

  for (const product of productRows) {
    // One line, or two a cent apart where no single cent price multiplies back
    // to what the item actually came to. See `exactLines`.
    for (const line of exactLines(product.total, product.qty)) {
      output.push([
        invoiceDate,
        invoiceNo,
        "Geyser Website",
        "EUR",
        "1",
        product.itemName,
        product.sku,
        "",
        line.quantity.toFixed(),
        line.price.toFixed(2),
        "Shopify Sales",
      ]);
    }
  }

  for (const bucket of VAT_BUCKET_ORDER) {
    const amount = vatAgg.get(bucket);

    // Omitted, not printed as zero: a bucket nothing sold under this period
    // is not a real line on the invoice.
    if (!amount) continue;

    const label = VAT_BUCKET_LABELS[bucket];

    output.push([
      invoiceDate,
      invoiceNo,
      "Geyser Website",
      "EUR",
      "1",
      // Item Name and SKU stay empty, and the name goes in Item Desc: Zoho
      // reads Item Name as a lookup into the item list, and there is no
      // product called "VAT PL Regular" — the import fails on the whole file
      // rather than on the line. The Amazon invoice has always written its
      // VAT lines this way.
      "",
      "",
      label,
      "1",
      amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
      label,
    ]);
  }

  const sheet: ReportSheet = {
    name: "Shopify invoice for Zoho",
    headers: [...ZOHO_HEADERS],
    rows: output,
  };

  return {
    sheets: [sheet],
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
    warnings,
  };
}

/**
 * The line items this period's invoice would bill that SKU mapping cannot
 * answer for: no row at all, or rows that disagree about what the code is.
 *
 * It mirrors `generate`'s own row filter exactly, for the reason the other
 * invoices do — a looser or stricter check here would silently change what
 * actually gets invoiced — and identifies a line the same way, so what is
 * asked about is precisely what would otherwise go out wrong.
 */
function unmappedSkus(rows: readonly LedgerRow[], rules: RulesSnapshot): UnmappedSku[] {
  const found = new Map<string, UnmappedSku>();
  const sources = orderSourceMap(rows);

  for (const row of rows) {
    if (row.dataset !== "shopify_geyser") continue;

    const arrival = arrivalCountryOf(row, rules);

    if (isExcludedRow(row, rules, sources, arrival)) continue;

    const item = identify(row);

    if (!item) continue;
    if (row.gross === null) continue;
    if (row.quantity === null || row.quantity.isZero()) continue;

    const decision = decideSku(rules, "shopify_geyser", item.key, item.name);

    if (decision.kind !== "passthrough" && decision.kind !== "mismatch") continue;

    // The pair is the identity, not the code: one code can be two products,
    // and each needs its own answer.
    const key = `${item.key}\u0000${item.name}`;

    found.set(key, {
      key,
      sourceSku: item.key,
      sourceName: item.name,
      problem: decision.kind === "mismatch" ? "mismatch" : "unmapped",
      expectedNames: decision.kind === "mismatch" ? decision.expectedNames : [],
    });
  }

  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export const shopifyZohoInvoiceModule: ReportModule = {
  definition: {
    id: "shopify_zoho_invoice",
    label: "Shopify invoice for Zoho",
    datasets: ["shopify_geyser"],
    // Dated and numbered by month, like the Amazon and Allegro invoices — a
    // quarter has no meaning for either.
    granularity: ["month"],
    requiresEveryDataset: true,
    description:
      "Geyser's Shopify orders aggregated by item into invoice lines for Zoho, VAT split by market.",
    needs: "One Geyser Shopify sales report for the month.",
    why:
      "Built without it, that month's Shopify revenue and VAT are simply missing from what Zoho " +
      "sees — not understated, absent.",
    requiredRules: [{ channel: "shopify_geyser", key: "defaults" }],
  },
  unmappedSkus,
  generate: generateShopifyZohoInvoice,
};
