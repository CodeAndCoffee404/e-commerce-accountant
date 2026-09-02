import Decimal from "decimal.js";

export type PricedLine = { quantity: Decimal; price: Decimal };

/**
 * Splits `total` over `quantity` units into invoice lines whose prices are
 * whole cents and whose amounts add back up to `total` exactly.
 *
 * An invoice states a price per unit and lets the accounting multiply it by the
 * quantity, so a price rounded to the cent cannot express most totals: 14 500.16
 * over 351 units is 41.3138…, and 351 × 41.31 is 14 499.81 — thirty-five cents
 * of revenue that the ledger has and the invoice does not. Small, but always in
 * the same direction and never reconciling.
 *
 * The remainder is spread a cent at a time instead: the units that need it are
 * priced one cent higher (or lower, when the rounding went the other way) and
 * the rest keep the round price. Two lines for one product, a cent apart, and
 * the invoice adds up.
 *
 * Returns a single line whenever the round price already lands exactly, which
 * is the ordinary case.
 */
export function exactLines(total: Decimal, quantity: Decimal): PricedLine[] {
  if (quantity.lessThanOrEqualTo(0)) return [];

  const price = total.dividedBy(quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  // Both sides carry at most two decimals — `total` is a sum of money and
  // `price` was just rounded to the cent — so the remainder is a whole number
  // of cents, and this division is exact.
  const cents = total.minus(price.times(quantity)).times(100).toDecimalPlaces(0);

  // Goods so cheap that a unit does not reach a cent: there is no pair of cent
  // prices that states this at all, and spreading would only put most of the
  // units on a zero-priced line. One line, as before this function existed.
  if (cents.isZero() || price.lessThanOrEqualTo(0)) return [{ quantity, price }];

  const step = cents.isPositive() ? new Decimal("0.01") : new Decimal("-0.01");
  const nudged = price.plus(step);
  const count = cents.abs();

  // |remainder| is at most half a cent per unit, so the units that need
  // nudging never outnumber the units there are.
  //
  // The other guard is for goods too cheap to price: a cent over two units
  // would need one of them free, and a zero-priced line is a product given
  // away on an invoice. Such a group stays one line and keeps its cent of
  // drift — the exactness this function exists for is not worth billing
  // something at nothing.
  if (count.greaterThan(quantity) || nudged.lessThanOrEqualTo(0)) {
    return [{ quantity, price }];
  }

  const rest = quantity.minus(count);

  if (rest.isZero()) return [{ quantity: count, price: nudged }];

  // The nudged units first, so the odd price is next to the round one rather
  // than orphaned at the end of a long invoice.
  return [
    { quantity: count, price: nudged },
    { quantity: rest, price },
  ];
}
