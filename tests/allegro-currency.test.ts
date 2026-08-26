import { describe, expect, it } from "vitest";

import type { Grid } from "@/lib/ingest/classify";
import { mapAllegro } from "@/modules/channels/allegro";

/**
 * Allegro always writes a currency identifier after the amount. `currencyOf`
 * used to recognise only the four symbols seen so far and drop anything else
 * silently (the row's currency came back `null`, and the row was later
 * skipped as unrecognised). It now parses the identifier generically —
 * `unmappedCurrencies` (see currency-mapping-gate.test.ts) is what catches an
 * unfamiliar one before a build, rather than this function hiding it.
 */

const HEADERS = [
  "data",
  "data zaksięgowania",
  "identyfikator",
  "operacja",
  "operator",
  "kupujący",
  "oferta",
  "dostawa",
  "kwota",
  "saldo",
  "szczegóły operacji",
];

function gridOf(kwota: string): Grid {
  return [
    HEADERS,
    [
      "31.01.2025 14:32",
      "31.01.2025",
      "order-1",
      "wpłata",
      "PayU",
      "buyer;Name;Street;12-345 City",
      "111;Widget;1 szt.",
      "0.00 zł",
      kwota,
      "",
      "",
    ],
  ];
}

function rowFor(kwota: string) {
  const { rows } = mapAllegro({
    grid: gridOf(kwota),
    headerRowIndex: 0,
    country: null,
    period: { label: "2025.01 January", granularity: "month", start: "2025-01-01", end: "2025-01-31" },
  });

  return rows[0];
}

function currencyFor(kwota: string): string | null {
  return rowFor(kwota).currency;
}

describe("mapAllegro currency detection", () => {
  it("normalises the known symbols to their ISO code", () => {
    expect(currencyFor("239.89 zł")).toBe("PLN");
    expect(currencyFor("13255.00 HUF")).toBe("HUF");
    expect(currencyFor("208 Kč")).toBe("CZK");
    expect(currencyFor("10.50 €")).toBe("EUR");
  });

  it("keeps a literal ISO code as-is", () => {
    expect(currencyFor("10.00 EUR")).toBe("EUR");
  });

  it("still parses an identifier it has never seen, instead of dropping it", () => {
    expect(currencyFor("10.00 RON")).toBe("RON");
    expect(currencyFor("10.00 Kn")).toBe("KN");
  });

  it("does not let an unfamiliar identifier break the amount itself", () => {
    // Before the fix, only a fixed whitelist of tokens was stripped before the
    // number was parsed — a genuinely new one left text like "10.00Kn" behind,
    // which failed to parse and flagged a perfectly good amount as unreadable.
    const row = rowFor("-42.50 Kn");

    expect(row.gross?.toFixed(2)).toBe("-42.50");
    expect(row.needsAttention).toBe(false);
    expect(row.currency).toBe("KN");
  });

  it("is case-insensitive about a known symbol", () => {
    expect(currencyFor("10.00 ZŁ")).toBe("PLN");
  });

  it("returns null when there is nothing to read", () => {
    expect(currencyFor("-")).toBe(null);
  });
});
