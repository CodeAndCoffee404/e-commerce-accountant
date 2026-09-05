import Decimal from "decimal.js";

import { parseDecimalValue } from "@/lib/ingest/numbers";

import {
  allegroCurrencyRule,
  channelRule,
  describeRegistration,
  type SellerRegistration,
  sellerVatOn,
  splitGross,
  vatRateOn,
} from "@/lib/reports/rules";
import type { ShopifyProfile } from "@/modules/companies/types";

import {
  arrivalCountryOf,
  isDomestic,
  isSkippedCountry,
  notASale,
  notASaleReason,
  recomputesZeroTax,
  unpaidOrderWarning,
  shopifyOf,
} from "./shopify-orders";
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

/** Registrations the period asked for and the company does not hold. */
type Missing = Set<string>;

function skip(skipped: Skipped, reason: string): null {
  skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  return null;
}

/**
 * A row that cannot name the seller.
 *
 * Recorded twice on purpose: in `skipped`, where it reads as one more refused
 * row, and in `missing`, which the run turns into a refusal. Only the second
 * stops the report — a sheet that is short by every export sale looks exactly
 * like a quiet month.
 */
function skipUnregistered(
  skipped: Skipped,
  warnings: string[],
  missing: Missing,
  channel: string,
  registration: SellerRegistration,
  where = "",
): null {
  const described = describeRegistration(registration);

  missing.add(described);
  warnings.push(`${channel}: this company has no ${described}${where}`);

  return skip(skipped, `${channel}: no ${described}`);
}

/** Legacy writes dates into the sheet as a timestamp at midnight. */
function reportDate(date: string | null): string {
  return date === null ? "" : `${date} 00:00:00`;
}

/**
 * The registration a sale reported under `scheme`, taxed in `country`, takes.
 *
 * A scheme this does not know becomes a REGULAR registration in that country,
 * which the company will not hold — so the row is skipped with the scheme
 * named, rather than printed with whichever number happened to be nearest.
 */
function registrationFor(scheme: string, country: string): SellerRegistration {
  return scheme === "UNION-OSS" ? { scheme } : { scheme: "REGULAR", country };
}

function amount(value: Decimal): string {
  return value.toFixed();
}

export function generateOffAmazonSales(
  rows: readonly LedgerRow[],
  context: ReportContext,
): GeneratorResult {
  // At the top, not inside the row loop: a company with no shop should be
  // refused before anything is built, the way the Amazon and Allegro invoices
  // refuse — not part-way through, on whichever row happens to come first.
  const shop = shopifyOf(context);
  const skipped: Skipped = new Map();
  const warnings: string[] = [];
  const missing: Missing = new Set();
  const output: (string | number | null)[][] = [];

  for (const row of rows) {
    const mapped =
      row.dataset === "allegro"
        ? allegroRow(row, context, skipped, warnings, missing)
        : row.dataset === "cdiscount"
          ? cdiscountRow(row, context, skipped, warnings, missing)
          : row.dataset === shop.dataset
            ? shopifyRow(shop, row, context, skipped, warnings, missing)
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
    missingRegistrations: [...missing],
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
  missing: Missing,
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

  const on = row.occurredOn ?? context.period.end;
  const registration = registrationFor(rule.scheme, rule.country);
  const sellerVat = sellerVatOn(context.rules, registration, on);

  if (!sellerVat) return skipUnregistered(skipped, warnings, missing, "Allegro", registration);

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
    sellerVat,
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
  missing: Missing,
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

  const registration = registrationFor(defaults.scheme, defaults.arrivalCountry);
  const sellerVat = sellerVatOn(context.rules, registration, row.occurredOn ?? context.period.end);

  if (!sellerVat) return skipUnregistered(skipped, warnings, missing, "Cdiscount", registration);

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
    sellerVat,
    "",
    defaults.scheme,
  ];
}

/* ------------------------------------------------------------------ *
 * Shopify
 * ------------------------------------------------------------------ */

/** An amount, or null when the column holds something that is not one. */
function readMoney(value: string): Decimal | null {
  try {
    return parseDecimalValue(value, { decimalSeparator: ".", column: "Total" });
  } catch {
    return null;
  }
}

/** `FR TVA 20%` → 0.2. The rate is only ever written into the tax label. */
export function parseShopifyTaxRate(label: string | undefined): Decimal | null {
  const match = (label ?? "").match(/(\d+(?:[.,]\d+)?)\s*%/);

  if (!match) return null;

  return new Decimal(match[1].replace(",", ".")).dividedBy(100);
}

function shopifyRow(
  shop: ShopifyProfile,
  row: LedgerRow,
  context: ReportContext,
  skipped: Skipped,
  warnings: string[],
  missing: Missing,
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

  // The same test the Zoho invoice applies, from the same place: the two
  // reports are one month's money at two grains, and an order counted by one
  // and not the other is a discrepancy nobody can reconcile.
  const order = {
    source: row.raw["Source"] ?? "",
    total: readMoney(orderTotal),
    paymentMethod: row.raw["Payment Method"] ?? "",
  };
  const why = notASale(shop, order);

  if (why) {
    if (why === "unpaid") warnings.push(unpaidOrderWarning("Shopify", row.raw["Name"] ?? "", order));

    return skip(skipped, notASaleReason("Shopify", why));
  }

  const defaults = channelRule<{
    domesticScheme: string;
    exportScheme: string;
  }>(context.rules, shop.dataset, "defaults");

  if (!defaults) {
    warnings.push("Shopify: the defaults rule is missing");

    return skip(skipped, "Shopify: the defaults rule is missing");
  }

  const arrival = arrivalCountryOf(shop, row);

  // Swiss orders are out of scope by agreement, and silently — no marker in
  // the report, see the rules table in PLAN §1.
  if (isSkippedCountry(shop, arrival)) return skip(skipped, `Shopify: delivered to ${arrival}`);

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

  const departure = shop.departureCountry;
  const domestic = isDomestic(shop, arrival);
  const scheme = domestic ? defaults.domesticScheme : defaults.exportScheme;
  // Sold inside the departure country, the sale is taxed there and takes the
  // registration held there — not one in the country the order was placed
  // from, which for a domestic order is the same place anyway.
  const registration = registrationFor(scheme, departure);
  const sellerVat = sellerVatOn(context.rules, registration, row.occurredOn ?? context.period.end);

  if (!sellerVat) {
    return skipUnregistered(
      skipped,
      warnings,
      missing,
      "Shopify",
      registration,
      `, row ${row.sourceRowNumber}`,
    );
  }

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
  const reported = row.raw["Taxes"];
  let reportedVat: Decimal | null = null;

  try {
    reportedVat = parseDecimalValue(reported, { decimalSeparator: ".", column: "Taxes" });
  } catch {
    warnings.push(`Shopify: tax "${reported}" could not be read, row ${row.sourceRowNumber}`);
  }
  const computedVat = rate === null ? null : splitGross(total, rate).vat;

  const vat =
    reportedVat === null || (reportedVat.isZero() && recomputesZeroTax(shop, arrival))
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
    datasets: ["allegro", "cdiscount", "shopify_geyser"],
    granularity: ["month"],
    requiresEveryDataset: true,
    description: "Allegro, Cdiscount and Shopify normalised into one sheet.",
    needs: "Allegro, Cdiscount and Shopify EU, all three for the same month.",
    why:
      "Built from whichever channels happen to be uploaded, the sheet looks complete and " +
      "understates revenue by exactly the ones nobody noticed were absent.",
    requiredRules: [
      { channel: "allegro", key: "operation_types" },
      { channel: "allegro", key: "currency_map" },
      { channel: "cdiscount", key: "invoice_types" },
      { channel: "cdiscount", key: "defaults" },
      { channel: "shopify_geyser", key: "defaults" },
    ],
  },
  unmappedCurrencies,
  generate: generateOffAmazonSales,
};
