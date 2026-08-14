import { describe, expect, it } from "vitest";

import { computeDeltas } from "./queries";

const MONTH = "2026.07 July";
const PREVIOUS = "2026.06 June";

function row(dataset: string, currency: string, period: string, gross: string, country: string | null = null) {
  return { dataset, country, currency, period, gross };
}

describe("month-over-month deltas", () => {
  it("computes the percentage and flags a big swing", () => {
    const deltas = computeDeltas(
      [row("allegro", "PLN", PREVIOUS, "1000"), row("allegro", "PLN", MONTH, "1400")],
      MONTH,
      PREVIOUS,
    );

    expect(deltas).toHaveLength(1);
    expect(deltas[0].changePct).toBe(40);
    expect(deltas[0].flagged).toBe(true);
    expect(deltas[0].current).toBe("1400.00");
  });

  it("does not flag a small move", () => {
    const deltas = computeDeltas(
      [row("shopify", "EUR", PREVIOUS, "1000"), row("shopify", "EUR", MONTH, "1100")],
      MONTH,
      PREVIOUS,
    );

    expect(deltas[0].changePct).toBe(10);
    expect(deltas[0].flagged).toBe(false);
  });

  it("flags a channel that went completely quiet", () => {
    const deltas = computeDeltas([row("cdiscount", "EUR", PREVIOUS, "800")], MONTH, PREVIOUS);

    expect(deltas[0].current).toBe("0.00");
    expect(deltas[0].changePct).toBe(-100);
    expect(deltas[0].flagged).toBe(true);
  });

  it("marks a channel with no history as new rather than flagged", () => {
    const deltas = computeDeltas(
      // June exists — Allegro traded — so Shopify's appearance is a real "new".
      [row("allegro", "PLN", PREVIOUS, "1000"), row("shopify", "GBP", MONTH, "500")],
      MONTH,
      PREVIOUS,
    );

    const shopify = deltas.find((delta) => delta.channel === "Shopify")!;

    expect(shopify.changePct).toBeNull();
    expect(shopify.flagged).toBe(false);
  });

  it("returns nothing at all when the previous month is empty", () => {
    // The start of the record is not a comparison: every row would be "new"
    // and the table would be noise.
    const deltas = computeDeltas(
      [row("allegro", "PLN", MONTH, "1000"), row("shopify", "EUR", MONTH, "700")],
      MONTH,
      PREVIOUS,
    );

    expect(deltas).toEqual([]);
  });

  it("ignores swings on immaterial amounts", () => {
    // 3 -> 9 is +200% and means nothing.
    const deltas = computeDeltas(
      [row("allegro", "CZK", PREVIOUS, "3"), row("allegro", "CZK", MONTH, "9")],
      MONTH,
      PREVIOUS,
    );

    expect(deltas[0].flagged).toBe(false);
  });

  it("keeps countries and currencies apart and puts flagged rows first", () => {
    const deltas = computeDeltas(
      [
        row("amazon_monthly", "EUR", PREVIOUS, "1000", "DE"),
        row("amazon_monthly", "EUR", MONTH, "1050", "DE"),
        row("amazon_monthly", "EUR", PREVIOUS, "1000", "FR"),
        row("amazon_monthly", "EUR", MONTH, "400", "FR"),
      ],
      MONTH,
      PREVIOUS,
    );

    expect(deltas).toHaveLength(2);
    expect(deltas[0].country).toBe("FR");
    expect(deltas[0].flagged).toBe(true);
    expect(deltas[1].country).toBe("DE");
    expect(deltas[1].flagged).toBe(false);
  });

  it("drops rows that are zero on both sides", () => {
    const deltas = computeDeltas(
      [row("allegro", "HUF", PREVIOUS, "0"), row("allegro", "HUF", MONTH, "0")],
      MONTH,
      PREVIOUS,
    );

    expect(deltas).toHaveLength(0);
  });
});
