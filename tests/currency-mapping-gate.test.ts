import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import type { LedgerRow, RulesSnapshot } from "@/lib/reports/types";
import { ALLEGRO_CURRENCY_MAP } from "@/modules/channels/allegro";
import { offAmazonSalesModule } from "@/modules/reports/off-amazon-sales";

/**
 * Mirrors `sku-mapping-gate.test.ts`: `unmappedCurrencies` is what stops a
 * build on an Allegro currency currency_map has never seen, rather than
 * letting `allegroRow` skip every one of its rows with a warning. Fixtures
 * double as a check that this stays in step with `allegroRow`'s own filter.
 */

let nextId = 0;

function row(overrides: Partial<LedgerRow>): LedgerRow {
  nextId += 1;

  return {
    id: `row-${nextId}`,
    dataset: "allegro",
    channel: "allegro",
    countryCode: "PL",
    occurredOn: "2026-07-15",
    transactionType: "wpłata",
    currency: "PLN",
    gross: new Decimal(10),
    vatAmount: null,
    netAmount: null,
    sku: null,
    quantity: null,
    sourceFileId: "file-1",
    sourceRowNumber: 1,
    raw: { kupujący: "buyer;Name;Street;12-345 City" },
    ...overrides,
  };
}

const emptyRules: RulesSnapshot = {
  vatRates: [],
  sellerVatNumbers: [],
  skuMappings: [],
  channelRules: [],
};

const seededRules: RulesSnapshot = {
  ...emptyRules,
  channelRules: [{ channel: "allegro", key: "currency_map", value: ALLEGRO_CURRENCY_MAP }],
};

const unmappedCurrencies = offAmazonSalesModule.unmappedCurrencies!;

describe("offAmazonSalesModule.unmappedCurrencies", () => {
  it("flags a currency that would report but has no rule", () => {
    expect(unmappedCurrencies([row({ currency: "RON" })], emptyRules)).toEqual(["RON"]);
  });

  it("does not flag a currency that is already mapped", () => {
    expect(unmappedCurrencies([row({ currency: "PLN" })], seededRules)).toEqual([]);
  });

  it("ignores a line with no buyer — it is an Allegro fee, not a sale", () => {
    expect(unmappedCurrencies([row({ currency: "RON", raw: {} })], emptyRules)).toEqual([]);
  });

  it("ignores rows from other channels", () => {
    expect(
      unmappedCurrencies([row({ currency: "RON", dataset: "cdiscount" })], emptyRules),
    ).toEqual([]);
  });

  it("ignores a row with no currency at all", () => {
    expect(unmappedCurrencies([row({ currency: null })], emptyRules)).toEqual([]);
  });

  it("de-duplicates repeats and returns them sorted", () => {
    const rows = [row({ currency: "SEK" }), row({ currency: "RON" }), row({ currency: "SEK" })];

    expect(unmappedCurrencies(rows, emptyRules)).toEqual(["RON", "SEK"]);
  });
});
