import Decimal from "decimal.js";

import { parseDecimalValue } from "@/lib/ingest/numbers";

import { allegroCurrencyRule, channelRule, splitGross, vatRateOn } from "@/lib/reports/rules";

import type { ReportModule } from "./types";
import type {
  GeneratorResult,
  LedgerRow,
  ReportContext,
  ReportSheet,
  RulesSnapshot,
} from "@/lib/reports/types";

/**
 * Off-Amazon Sales: Allegro, Cdiscount and Shopify normalised into one shape.
 *
 * This is the core business logic of the project, and the three channels agree
 * on almost nothing — each reports a different subset and calls it different
 * things. What they have in common is only what this sheet's thirteen columns
 * say.
 */
export const OFF_AMAZON_HEADERS = [
  "Sales channel",
  "transaction date",
  "transaction type",
  "currency",
  "VAT rate",
  "VAT amount",
  "Net amount",
  "Total",
  "departure country",
  "arrival country",
  "seller VAT number",
  "buyer VAT number",
  "TAX_REPORTING_SCHEME",
] as const;

type Skipped = Map<string, number>;

function skip(skipped: Skipped, reason: string): null {
  skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  return null;
}

/** Legacy writes dates into the sheet as a timestamp at midnight. */
function reportDate(date: string | null): string {
  return date === null ? "" : `${date} 00:00:00`;
}

function amount(value: Decimal): string {
  return value.toFixed();
}

export function generateOffAmazonSales(
  rows: readonly LedgerRow[],
  context: ReportContext,
): GeneratorResult {
  const skipped: Skipped = new Map();
  const warnings: string[] = [];
  const output: (string | number | null)[][] = [];

  for (const row of rows) {
    const mapped =
      row.dataset === "allegro"
        ? allegroRow(row, context, skipped, warnings)
        : row.dataset === "cdiscount"
          ? cdiscountRow(row, context, skipped, warnings)
          : row.dataset === "shopify"
            ? shopifyRow(row, context, skipped, warnings)
            : skip(skipped, `Channel ${row.dataset} is not part of this report`);

    if (mapped) output.push(mapped);
  }

  const sheet: ReportSheet = {
    name: "off-amazon sales",
    headers: [...OFF_AMAZON_HEADERS],
    rows: output,
  };

  return {
    sheets: [sheet],
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
    warnings,
  };
}

/* ------------------------------------------------------------------ *
 * Allegro
 * ------------------------------------------------------------------ */

function allegroRow(
  row: LedgerRow,
  context: ReportContext,
  skipped: Skipped,
  warnings: string[],
): (string | number | null)[] | null {
  // Only lines with a buyer are sales. The rest are Allegro's own fees, and
  // the statement mixes them into the same list.
  if (!row.raw["kupujący"]) return skip(skipped, "Allegro: no buyer on the line, so it is a fee");

  const operations = channelRule<Record<string, string>>(
    context.rules,
    "allegro",
    "operation_types",
  );
  const operation = row.raw["operacja"] ?? row.transactionType ?? "";
  const type = operations?.[operation];

  if (!type) {
    // Legacy aborts the whole report here. Skipping one row and naming it is
    // more useful: the operator sees what to fix instead of nothing at all.
    warnings.push(`Allegro: unknown operation "${operation}" on row ${row.sourceRowNumber}`);

    return skip(skipped, "Allegro: unknown operation type");
  }

  if (row.gross === null) return skip(skipped, "Allegro: amount could not be read");

  const currency = row.currency;

  if (!currency) return skip(skipped, "Allegro: currency not determined");

  const rule = allegroCurrencyRule(context.rules, currency);

  if (!rule) {
    warnings.push(`Allegro: no rule for currency ${currency}`);

    return skip(skipped, "Allegro: currency has no rule");
  }

  const rate = vatRateOn(context.rules, rule.country, row.occurredOn ?? context.period.end);

  if (!rate) {
    warnings.push(`Allegro: no VAT rate for ${rule.country}`);

    return skip(skipped, "Allegro: no VAT rate");
  }

  // A refund is negative, whatever sign the statement used. Single rule across
  // every channel, agreed in PLAN §1.
  const total = type === "REFUND" ? row.gross.abs().negated() : row.gross;
  const { vat, net } = splitGross(total, rate);
  const departure = channelRule<string>(context.rules, "allegro", "departure_country") ?? "PL";

  return [
    "Allegro",
    reportDate(row.occurredOn),
    type,
    currency,
    rate.toFixed(),
    amount(vat),
    amount(net),
    amount(total),
    departure,
    rule.country,
    rule.sellerVat,
    "",
    rule.scheme,
  ];
}

/**
 * Currencies this period's Allegro rows actually settle in that currency_map
 * has no rule for — checked the same way as an unmapped SKU, before anything
 * builds, since `allegroRow` above would otherwise just skip the row with a
 * warning and understate the period.
 */
function unmappedCurrencies(rows: readonly LedgerRow[], rules: RulesSnapshot): string[] {
  const found = new Set<string>();

  for (const row of rows) {
    if (row.dataset !== "allegro") continue;
    // Same filter as allegroRow: a line with no buyer is a fee, not a sale,
    // and never reaches the currency lookup.
    if (!row.raw["kupujący"]) continue;
    if (!row.currency) continue;
    if (allegroCurrencyRule(rules, row.currency)) continue;

    found.add(row.currency);
  }

  return [...found].sort();
}

/* ------------------------------------------------------------------ *
 * Cdiscount
 * ------------------------------------------------------------------ */

function cdiscountRow(
  row: LedgerRow,
  context: ReportContext,
  skipped: Skipped,
  warnings: string[],
): (string | number | null)[] | null {
  const types = channelRule<Record<string, string>>(context.rules, "cdiscount", "invoice_types");
  const invoiceType = row.raw["Invoice type"] ?? row.transactionType ?? "";
  const type = types?.[invoiceType];

  // Subscriptions, commission credits and guarantee reserves are not sales.
  if (!type) return skip(skipped, `Cdiscount: type "${invoiceType}" is not a sale`);

  if (row.gross === null) return skip(skipped, "Cdiscount: amount could not be read");

  const defaults = channelRule<{
    currency: string;
    departureCountry: string;
    arrivalCountry: string;
    scheme: string;
    sellerVat: string;
  }>(context.rules, "cdiscount", "defaults");

  if (!defaults) {
    warnings.push("Cdiscount: the defaults rule is missing");

    return skip(skipped, "Cdiscount: the defaults rule is missing");
  }

  const rate = vatRateOn(
    context.rules,
    defaults.arrivalCountry,
    row.occurredOn ?? context.period.end,
  );

  if (!rate) {
    warnings.push(`Cdiscount: no VAT rate for ${defaults.arrivalCountry}`);

    return skip(skipped, "Cdiscount: no VAT rate");
  }

  const total = type === "REFUND" ? row.gross.abs().negated() : row.gross;
  // Cdiscount reports its own VAT column as zero, so it is recomputed from the
  // gross rather than trusted.
  const { vat, net } = splitGross(total, rate);

  return [
    "Cdiscount",
    reportDate(row.occurredOn),
    type,
    defaults.currency,
    rate.toFixed(),
    amount(vat),
    amount(net),
    amount(total),
    defaults.departureCountry,
    defaults.arrivalCountry,
    defaults.sellerVat,
    "",
    defaults.scheme,
  ];
}

/* ------------------------------------------------------------------ *
 * Shopify
 * ------------------------------------------------------------------ */

/** `FR TVA 20%` → 0.2. The rate is only ever written into the tax label. */
export function parseShopifyTaxRate(label: string | undefined): Decimal | null {
  const match = (label ?? "").match(/(\d+(?:[.,]\d+)?)\s*%/);

  if (!match) return null;

  return new Decimal(match[1].replace(",", ".")).dividedBy(100);
}

function shopifyRow(
  row: LedgerRow,
  context: ReportContext,
  skipped: Skipped,
  warnings: string[],
): (string | number | null)[] | null {
  // One row per order, not per line item.
  //
  // The ledger keeps line items, which is the right grain for a ledger — a
  // refund or a price question is about one item. This report is about orders:
  // its columns are the order's currency, rate and total. Shopify writes the
  // order-level columns on the first line of an order and leaves them empty on
  // the rest, so their presence is what identifies that first line.
  const orderTotal = row.raw["Total"];

  if (!orderTotal) return skip(skipped, "Shopify: a line item; the order total comes from the first row");

  const excluded = channelRule<string[]>(context.rules, "shopify", "excluded_sources") ?? [];

  if (excluded.includes(row.raw["Source"] ?? "")) {
    return skip(skipped, "Shopify: draft order");
  }

  const defaults = channelRule<{
    departureCountry: string;
    domesticScheme: string;
    domesticSellerVat: string;
    exportScheme: string;
    exportSellerVat: string;
  }>(context.rules, "shopify", "defaults");

  if (!defaults) {
    warnings.push("Shopify: the defaults rule is missing");

    return skip(skipped, "Shopify: the defaults rule is missing");
  }

  const aliases = channelRule<Record<string, string>>(context.rules, "shopify", "country_aliases") ?? {};
  const raw = row.raw["Shipping Country"] || row.raw["Billing Country"] || row.countryCode || "";
  const arrival = aliases[raw] ?? raw;

  const skippedCountries =
    channelRule<string[]>(context.rules, "shopify", "skipped_arrival_countries") ?? [];

  // Swiss orders are out of scope by agreement, and silently — no marker in
  // the report, see the rules table in PLAN §1.
  if (skippedCountries.includes(arrival)) return skip(skipped, `Shopify: delivered to ${arrival}`);

  // The shared parser, not `new Decimal(...)`: it knows about spaces used for
  // thousands, a currency written beside the amount and a Unicode minus, and it
  // reports a failure instead of throwing out of the whole report.
  let total: Decimal | null;

  try {
    total = parseDecimalValue(orderTotal, { decimalSeparator: ".", column: "Total" });
  } catch {
    total = null;
  }

  if (total === null) {
    warnings.push(`Shopify: order total "${orderTotal}" could not be read, row ${row.sourceRowNumber}`);

    return skip(skipped, "Shopify: order total could not be read");
  }

  const departure = defaults.departureCountry;
  const domestic = arrival === departure;
  const scheme = domestic ? defaults.domesticScheme : defaults.exportScheme;
  const sellerVat = domestic ? defaults.domesticSellerVat : defaults.exportSellerVat;

  const labelled = parseShopifyTaxRate(row.raw["Tax 1 Name"]);
  const fallback = vatRateOn(context.rules, arrival, row.occurredOn ?? context.period.end);
  const rate = labelled ?? fallback;

  if (!rate) {
    // Legacy highlights the cell yellow and leaves it to a human. The agreed
    // replacement is a flag on the row: the fix is in the source file.
    warnings.push(
      `Shopify: no VAT rate for ${arrival}, row ${row.sourceRowNumber}`,
    );
  }

  // Shopify reports the tax it charged, and that figure is the one the buyer's
  // invoice shows — recomputing it from the rate would quietly disagree with a
  // document that already exists.
  //
  // Britain is the exception: those orders arrive with zero tax and no rate in
  // the label, and the VAT is real. Which countries that applies to is a rule,
  // not a constant, because zero elsewhere means zero.
  const recompute =
    channelRule<string[]>(context.rules, "shopify", "recompute_zero_tax_countries") ?? [];
  const reported = row.raw["Taxes"];
  let reportedVat: Decimal | null = null;

  try {
    reportedVat = parseDecimalValue(reported, { decimalSeparator: ".", column: "Taxes" });
  } catch {
    warnings.push(`Shopify: tax "${reported}" could not be read, row ${row.sourceRowNumber}`);
  }
  const computedVat = rate === null ? null : splitGross(total, rate).vat;

  const vat =
    reportedVat === null || (reportedVat.isZero() && recompute.includes(arrival))
      ? computedVat
      : reportedVat;
  const net = vat === null ? null : total.minus(vat);

  return [
    "Shopify",
    reportDate(row.occurredOn),
    total.isNegative() ? "REFUND" : "B2C SALE",
    row.currency ?? "",
    rate === null ? "" : rate.toFixed(),
    vat === null ? "" : amount(vat),
    net === null ? "" : amount(net),
    amount(total),
    departure,
    arrival,
    sellerVat,
    "",
    scheme,
  ];
}

export const offAmazonSalesModule: ReportModule = {
  definition: {
    id: "off_amazon_sales",
    label: "Off-Amazon Sales",
    datasets: ["allegro", "cdiscount", "shopify"],
    granularity: ["month"],
    requiresEveryDataset: true,
    description: "Allegro, Cdiscount and Shopify normalised into one sheet.",
    needs: "Allegro, Cdiscount and Shopify, all three for the same month.",
    why:
      "Built from whichever channels happen to be uploaded, the sheet looks complete and " +
      "understates revenue by exactly the ones nobody noticed were absent.",
    requiredRules: [
      { channel: "allegro", key: "operation_types" },
      { channel: "allegro", key: "currency_map" },
      { channel: "cdiscount", key: "invoice_types" },
      { channel: "cdiscount", key: "defaults" },
      { channel: "shopify", key: "defaults" },
    ],
  },
  unmappedCurrencies,
  generate: generateOffAmazonSales,
};
