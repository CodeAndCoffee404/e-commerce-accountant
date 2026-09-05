import type Decimal from "decimal.js";

import type { LedgerRow, ReportContext } from "@/lib/reports/types";
import type { ShopifyProfile } from "@/modules/companies/types";

/**
 * Which Shopify orders are sales, shared by the two reports that read them.
 *
 * Off-Amazon Sales and the Zoho invoice must agree about this to the order:
 * they are the same month's money seen at two grains, and a shop giveaway
 * counted by one and not the other is a discrepancy nobody can reconcile.
 * So the test lives here once, and neither report gets to have its own idea.
 *
 * These are the company's own facts, not channel rules. A rule is for
 * something the business changes month to month — which countries break out
 * their own VAT line, what a currency means. This is not that: it is what the
 * shop's own workflow does, it must hold for both reports at once, and an
 * editable copy of it is a switch that silently puts giveaways and unpaid
 * orders into an invoice. Being unable to edit it is the point.
 *
 * They live in the company profile now rather than in this file, which changes
 * where they are written and nothing about how: a profile is code, changed by
 * a pull request with a golden test. What it buys is a second company with its
 * own answers, without either company's becoming a setting.
 */

/**
 * The Shopify facts of the company this report is for.
 *
 * Throws rather than defaulting: a company with no shop has no answer to "what
 * counts as a sale here", and inventing one would mean building a report from
 * another company's workflow.
 */
export function shopifyOf(context: ReportContext): ShopifyProfile {
  if (!context.company.shopify) {
    throw new Error("This company has no Shopify shop, so this report cannot be built.");
  }

  return context.company.shopify;
}

/** The order-level columns this judgement needs; Shopify writes them on an order's first line. */
export type ShopifyOrder = {
  source: string;
  total: Decimal | null;
  paymentMethod: string;
};

export type NotASale =
  /** A hand-made order with no money in it: a warranty replacement or an adapter. */
  | "giveaway"
  /** Money it cannot have taken. Somebody has to fix this order in Shopify. */
  | "unpaid";

/**
 * Why this order is not a sale, or null when it is one.
 *
 * A hand-made order paid for by card is an ordinary sale that happens to have
 * been typed in by a person, and is billed like any other.
 */
export function notASale(shop: ShopifyProfile, order: ShopifyOrder | undefined): NotASale | null {
  if (!order) return null;

  // Everything here is about orders somebody typed in by hand. An order nobody
  // typed by hand is a sale: it came through a checkout, which is the shop's
  // ordinary way of taking money.
  if (!shop.handMadeSources.includes(order.source)) return null;

  // An unreadable total counts as no money: the report says so elsewhere, and
  // guessing that it might have been a sale is the wrong way to be wrong.
  if (!order.total?.greaterThan(0)) return "giveaway";

  // It claims money. The shop takes cards, so a hand-typed "paid" is the known
  // mistake on a warranty replacement: the 100% discount that should have
  // zeroed it was never applied.
  return shop.methodsThatAreNotPayments.includes(order.paymentMethod) ? "unpaid" : null;
}

/**
 * What to tell the person building the report about an order that claims money
 * it cannot have taken.
 *
 * Named one by one rather than counted: each is an order somebody has to go and
 * correct, and until it is corrected the month is understated by exactly this
 * much. A giveaway needs no such message — it is the workflow working.
 */
export function unpaidOrderWarning(report: string, orderName: string, order: ShopifyOrder): string {
  return (
    `${report}: order ${orderName} was made by hand and marked paid by ` +
    `"${order.paymentMethod}", which the shop does not accept — ` +
    `${order.total?.toFixed(2) ?? "?"} left out. If it is a warranty replacement it needs a ` +
    "100% discount in Shopify; if it was really bought, the payment needs recording."
  );
}

/** The skipped-row reason, one wording for both reports. */
export function notASaleReason(report: string, why: NotASale): string {
  return why === "giveaway"
    ? `${report}: made by hand, nothing paid`
    : `${report}: made by hand, marked paid by a means the shop does not accept`;
}


/* ------------------------------------------------------------------------ *
 * Where the goods leave from, and what follows from it.
 *
 * One decision underlies everything both reports say about tax: whether the
 * order stayed in the country the goods ship from. Domestic is the shop's home
 * regime, REGULAR; anything crossing a border is UNION-OSS. Off-Amazon Sales
 * turns that into the scheme and the seller's VAT number it prints; the
 * invoice turns the same answer into which VAT account the line posts to.
 *
 * It lived in an editable rule while the invoice quietly hard-coded "ES" for
 * the domestic account. Moving the warehouse in Settings would then have sent
 * the new country's domestic VAT to Spain's account, silently. The country is
 * a fact about the business, not a monthly setting — so it lives in the
 * company profile, and both uses read it from there.
 * ------------------------------------------------------------------------ */

/** Sold and shipped without leaving the departure country: the home regime. */
export function isDomestic(shop: ShopifyProfile, arrival: string): boolean {
  return arrival === shop.departureCountry;
}

/**
 * Where the order went. Shipping address first, billing as the fallback, and
 * whatever the ledger recorded last of all — then through the shop's aliases,
 * because an export can spell a country differently from the reports.
 */
export function arrivalCountryOf(shop: ShopifyProfile, row: LedgerRow): string {
  const raw = row.raw["Shipping Country"] || row.raw["Billing Country"] || row.countryCode || "";

  return shop.countryAliases[raw] ?? raw;
}

/** Out of scope by agreement, and silently — no marker anywhere. */
export function isSkippedCountry(shop: ShopifyProfile, arrival: string): boolean {
  return shop.skippedArrivalCountries.includes(arrival);
}

/**
 * Countries whose orders arrive with a zero tax that is known to be wrong.
 * British orders carry no rate in the label either, so the VAT is computed
 * from the order total instead. Everywhere else a zero means zero and must not
 * be filled in.
 */
export function recomputesZeroTax(shop: ShopifyProfile, arrival: string): boolean {
  return shop.recomputeZeroTaxCountries.includes(arrival);
}
