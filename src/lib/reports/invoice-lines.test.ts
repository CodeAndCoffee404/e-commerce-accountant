import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import { allocate, exactLines } from "./invoice-lines";

function sum(lines: { quantity: Decimal; price: Decimal }[]): Decimal {
  return lines.reduce((total, line) => total.plus(line.price.times(line.quantity)), new Decimal(0));
}

describe("exactLines", () => {
  it("leaves one line where the cent price already lands exactly", () => {
    expect(exactLines(new Decimal("100.00"), new Decimal(4))).toEqual([
      { quantity: new Decimal(4), price: new Decimal("25") },
    ]);
  });

  it("spreads the remainder a cent at a time", () => {
    // 14 500.16 over 351 units: 41.3138… a unit, which no cent price states.
    const lines = exactLines(new Decimal("14500.16"), new Decimal(351));

    expect(lines.map((line) => [line.quantity.toFixed(), line.price.toFixed(2)])).toEqual([
      ["35", "41.32"],
      ["316", "41.31"],
    ]);
    expect(sum(lines).toFixed(2)).toBe("14500.16");
  });

  it("nudges downwards when the rounding went up", () => {
    // 10.00 over 3: 3.3333… rounds to 3.33, and 3 × 3.33 is 9.99 — one cent
    // short, so one unit carries 3.34.
    const lines = exactLines(new Decimal("10.00"), new Decimal(3));

    expect(sum(lines).toFixed(2)).toBe("10.00");

    // 20.00 over 3 rounds the other way: 6.67 × 3 is 20.01, a cent too much.
    const other = exactLines(new Decimal("20.00"), new Decimal(3));

    expect(other.map((line) => [line.quantity.toFixed(), line.price.toFixed(2)])).toEqual([
      ["1", "6.66"],
      ["2", "6.67"],
    ]);
    expect(sum(other).toFixed(2)).toBe("20.00");
  });

  it("adds up exactly across a spread of awkward totals", () => {
    for (const quantity of [1, 2, 3, 7, 13, 99, 351, 1000]) {
      for (const total of ["1.00", "10.03", "99.99", "14500.16", "7.77", "0.99"]) {
        const lines = exactLines(new Decimal(total), new Decimal(quantity));
        const unit = new Decimal(total).dividedBy(quantity);

        // Above the floor where a cent price has room to move either way, the
        // lines are exact and the quantity is whole.
        if (unit.greaterThanOrEqualTo("0.02")) {
          expect(sum(lines).toFixed(2)).toBe(new Decimal(total).toFixed(2));
          for (const line of lines) expect(line.price.greaterThan(0)).toBe(true);
        }

        expect(
          lines.reduce((count, line) => count.plus(line.quantity), new Decimal(0)).toFixed(),
        ).toBe(String(quantity));

        for (const line of lines) {
          expect(line.price.decimalPlaces()).toBeLessThanOrEqual(2);
          expect(line.quantity.greaterThan(0)).toBe(true);
        }
      }
    }
  });

  it("keeps its cent rather than bill a unit at nothing", () => {
    // A cent over two units would need one of them free. The drift stays.
    expect(exactLines(new Decimal("0.01"), new Decimal(2))).toEqual([
      { quantity: new Decimal(2), price: new Decimal("0.01") },
    ]);
  });

  it("refuses to invent a price for nothing", () => {
    expect(exactLines(new Decimal("10.00"), new Decimal(0))).toEqual([]);
  });
});

describe("allocate", () => {
  const d = (value: string | number) => new Decimal(value);
  const sum = (parts: Decimal[]) => parts.reduce((t, p) => t.plus(p), new Decimal(0));

  it("splits in proportion when the shares land on whole cents", () => {
    expect(allocate(d("90.00"), [d("60.00"), d("30.00")]).map((p) => p.toFixed(2))).toEqual([
      "60.00",
      "30.00",
    ]);
  });

  it("gives the leftover cents to the shares that were cut by most", () => {
    // 10.00 over three equal lines is 3.3333… each; two lines have to carry
    // the extra cent, and the parts still add to ten.
    const parts = allocate(d("10.00"), [d(1), d(1), d(1)]);

    expect(parts.map((p) => p.toFixed(2))).toEqual(["3.34", "3.33", "3.33"]);
    expect(sum(parts).toFixed(2)).toBe("10.00");
  });

  it("adds back up to the total exactly, whatever the weights", () => {
    // The property that matters: an invoice built from these parts reconciles
    // with the order it came from.
    for (let n = 1; n <= 12; n += 1) {
      for (const total of ["113.90", "0.03", "999.99", "45.90", "1.00"]) {
        const weights = Array.from({ length: n }, (_, i) => d(String((i * 7919) % 97 || 3)));

        expect(sum(allocate(d(total), weights)).toFixed(2)).toBe(d(total).toFixed(2));
      }
    }
  });

  it("has nothing to go on when every weight is zero", () => {
    // Free items only: no proportion exists, so nothing is placed and the
    // caller is left able to see that.
    expect(allocate(d("10.00"), [d(0), d(0)]).map((p) => p.toFixed(2))).toEqual(["0.00", "0.00"]);
  });

  it("returns nothing for nothing", () => {
    expect(allocate(d("10.00"), [])).toEqual([]);
  });
});
