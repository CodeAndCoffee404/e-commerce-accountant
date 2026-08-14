import { describe, expect, it } from "vitest";

import { summariseWarnings } from "./warnings";

describe("summarising run warnings", () => {
  it("keeps a lone warning exactly as it was written", () => {
    expect(summariseWarnings(["Shopify: the defaults rule is missing"])).toEqual([
      "Shopify: the defaults rule is missing",
    ]);
  });

  it("collapses the same problem on many rows into one line", () => {
    const warnings = [10, 11, 14, 15].map(
      (row) => `Allegro: unknown operation "wpłata" on row ${row}`,
    );

    expect(summariseWarnings(warnings)).toEqual([
      'Allegro: unknown operation "wpłata" — 4 rows, first on row 10',
    ]);
  });

  it("names the lowest row, not the first one it happened to see", () => {
    const warnings = [
      "Allegro: unknown operation \"zwrot\" on row 84",
      "Allegro: unknown operation \"zwrot\" on row 78",
    ];

    expect(summariseWarnings(warnings)).toEqual([
      'Allegro: unknown operation "zwrot" — 2 rows, first on row 78',
    ]);
  });

  it("counts a repeated warning that carries no row at all", () => {
    const warnings = Array.from({ length: 8 }, () => "Shopify: the defaults rule is missing");

    expect(summariseWarnings(warnings)).toEqual([
      "Shopify: the defaults rule is missing — 8 times",
    ]);
  });

  it("keeps different operations apart", () => {
    const warnings = [
      'Allegro: unknown operation "wpłata" on row 10',
      'Allegro: unknown operation "zwrot" on row 78',
      'Allegro: unknown operation "wpłata" on row 11',
    ];

    expect(summariseWarnings(warnings)).toEqual([
      'Allegro: unknown operation "wpłata" — 2 rows, first on row 10',
      'Allegro: unknown operation "zwrot" on row 78',
    ]);
  });

  it("handles the comma form the Shopify generator uses", () => {
    const warnings = [
      'Shopify: tax "abc" could not be read, row 4',
      'Shopify: tax "abc" could not be read, row 9',
    ];

    expect(summariseWarnings(warnings)).toEqual([
      'Shopify: tax "abc" could not be read — 2 rows, first on row 4',
    ]);
  });
});
