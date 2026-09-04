import type Decimal from "decimal.js";

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
  /** No money in it: a warranty replacement or an adapter going out. */
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
  if (!order || !HAND_MADE_SOURCES.includes(order.source)) return null;

  // An unreadable total counts as no money: the report says so elsewhere, and
  // guessing that it might have been a sale is the wrong way to be wrong.
  if (!order.total?.greaterThan(0)) return "giveaway";

  return METHODS_THAT_ARE_NOT_PAYMENTS.includes(order.paymentMethod) ? "unpaid" : null;
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
