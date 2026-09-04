import type Decimal from "decimal.js";

import type { LedgerRow } from "@/lib/reports/types";

/**
 * Which Shopify orders are sales, shared by the two reports that read them.
 *
 * Off-Amazon Sales and the Zoho invoice must agree about this to the order:
 * they are the same month's money seen at two grains, and a shop giveaway
 * counted by one and not the other is a discrepancy nobody can reconcile.
 * So the test lives here once, and neither report gets to have its own idea.
 *
 * These are constants, not channel rules. A rule is for something the business
 * changes — which countries break out their own VAT line, what a currency
 * means. This is not that: it is what the shop's own workflow does, it must
 * hold for both reports at once, and an editable copy of it is a switch that
 * silently puts giveaways and unpaid orders into an invoice. Being unable to
 * edit it is the point.
 */

/**
 * Orders an employee wrote up by hand in the admin, through the draft-order
 * screen. Shopify shows them as ordinary orders once completed — only the
 * export still says where they came from. This is how a warranty replacement
 * and an adapter ship.
 */
const HAND_MADE_SOURCES: readonly string[] = ["shopify_draft_order"];

/**
 * The shop takes card payments only. An order marked paid by any of these was
 * not paid at all — it is the known mistake on a warranty replacement, which
 * should have been zeroed with a 100% discount and was marked paid instead.
 */
const METHODS_THAT_ARE_NOT_PAYMENTS: readonly string[] = ["manual"];

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
export function notASale(order: ShopifyOrder | undefined): NotASale | null {
  if (!order) return null;

  // Money that cannot have arrived, whatever the order looks like otherwise.
  // The shop takes cards; that is a fact about the shop, not about how an
  // order was typed in, so it is checked before the source and independently
  // of it. Today every such order also happens to be hand-made — but the two
  // things move independently, and a web order marked paid by hand would be
  // just as unpaid.
  if (order.total?.greaterThan(0) && METHODS_THAT_ARE_NOT_PAYMENTS.includes(order.paymentMethod)) {
    return "unpaid";
  }

  // The rest is about how the order was made. An order nobody typed by hand is
  // a sale: it came through a checkout, which is the shop's ordinary way of
  // taking money.
  if (!HAND_MADE_SOURCES.includes(order.source)) return null;

  // An unreadable total counts as no money: the report says so elsewhere, and
  // guessing that it might have been a sale is the wrong way to be wrong.
  return order.total?.greaterThan(0) ? null : "giveaway";
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
 * a fact about the business, not a monthly setting — so it is here, and both
 * uses read the same constant.
 * ------------------------------------------------------------------------ */

/** Geyser's Shopify shop ships from Spain, always. */
export const DEPARTURE_COUNTRY = "ES";

/** Sold and shipped without leaving the departure country: the home regime. */
export function isDomestic(arrival: string): boolean {
  return arrival === DEPARTURE_COUNTRY;
}

/** Shopify writes `UK`; reporting needs `GB`. */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = { UK: "GB" };

/**
 * Where the order went. Shipping address first, billing as the fallback, and
 * whatever the ledger recorded last of all.
 */
export function arrivalCountryOf(row: LedgerRow): string {
  const raw = row.raw["Shipping Country"] || row.raw["Billing Country"] || row.countryCode || "";

  return COUNTRY_ALIASES[raw] ?? raw;
}

/** Switzerland is out of scope by agreement, and silently — no marker anywhere. */
const SKIPPED_ARRIVAL_COUNTRIES: readonly string[] = ["CH"];

export function isSkippedCountry(arrival: string): boolean {
  return SKIPPED_ARRIVAL_COUNTRIES.includes(arrival);
}

/**
 * Countries whose orders arrive with a zero tax that is known to be wrong.
 * British orders carry no rate in the label either, so the VAT is computed
 * from the order total instead. Everywhere else a zero means zero and must not
 * be filled in.
 */
const RECOMPUTE_ZERO_TAX_COUNTRIES: readonly string[] = ["GB"];

export function recomputesZeroTax(arrival: string): boolean {
  return RECOMPUTE_ZERO_TAX_COUNTRIES.includes(arrival);
}
