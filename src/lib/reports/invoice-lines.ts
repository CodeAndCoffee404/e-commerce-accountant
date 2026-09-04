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

/**
 * Splits `total` across `weights` in proportion, to the cent, so the parts add
 * back up to `total` exactly.
 *
 * For an order-level amount that has to reach the line items: a discount code
 * takes money off the order, not off any one product, and the invoice can only
 * state products. Rounding each share on its own leaves the parts a cent or
 * two off the whole, always in the same direction, so the last cents go to the
 * shares that were cut by most — the largest-remainder method.
 *
 * Weightless input (every weight zero, or none at all) has no proportion to
 * follow: the parts come back zero and the caller is left to notice that the
 * total went nowhere.
 */
export function allocate(total: Decimal, weights: readonly Decimal[]): Decimal[] {
  if (weights.length === 0) return [];

  const sum = weights.reduce((t, w) => t.plus(w), new Decimal(0));

  if (sum.isZero()) return weights.map(() => new Decimal(0));

  const exact = weights.map((weight) => total.times(weight).dividedBy(sum));
  const parts = exact.map((share) => share.toDecimalPlaces(2, Decimal.ROUND_DOWN));
  const placed = parts.reduce((t, part) => t.plus(part), new Decimal(0));

  // Whole cents: `total` is money and every part was just truncated to the
  // cent, so what is left over divides exactly.
  let left = total.minus(placed).times(100).toDecimalPlaces(0).toNumber();
  const step = left < 0 ? new Decimal("-0.01") : new Decimal("0.01");

  const order = exact
    .map((share, index) => ({ index, remainder: share.minus(parts[index]).abs() }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);

  for (let i = 0; left !== 0 && i < order.length; i += 1) {
    parts[order[i].index] = parts[order[i].index].plus(step);
    left += left < 0 ? 1 : -1;
  }

  return parts;
}
