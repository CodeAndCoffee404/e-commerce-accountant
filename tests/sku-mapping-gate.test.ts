import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import type { LedgerRow, RulesSnapshot } from "@/lib/reports/types";
import { amazonZohoInvoiceModule } from "@/modules/reports/amazon-zoho-invoice";

/**
 * `unmappedSkus` is what stops a build on SKUs SKU mapping has never seen,
 * rather than letting them reach the invoice under their own raw code. It
 * deliberately mirrors `generateZohoInvoice`'s own row filter instead of
 * sharing it, so these fixtures double as a check that the two stay in
 * step: a row this test expects to invoice should be one the generator
 * would actually invoice, and vice versa.
 */

let nextId = 0;

function row(overrides: Partial<LedgerRow>): LedgerRow {
  nextId += 1;

  return {
    id: `row-${nextId}`,
    dataset: "amazon_monthly",
    channel: "amazon",
    countryCode: "DE",
    occurredOn: "2026-05-15",
    transactionType: "Bestellung",
    currency: "EUR",
    gross: new Decimal(10),
    vatAmount: new Decimal(1.6),
    netAmount: new Decimal(8.4),
    sku: "SKU-1",
    quantity: new Decimal(1),
    sourceFileId: "file-1",
    sourceRowNumber: 1,
    raw: {},
    ...overrides,
  };
}

const emptyRules: RulesSnapshot = {
  vatRates: [],
  sellerVatNumbers: [],
  skuMappings: [],
  channelRules: [],
};

const askAbout = amazonZohoInvoiceModule.unmappedSkus!;

/**
 * Amazon reports a code and no name to check it against, so every question it
 * raises is the same shape. The codes are what these are about.
 */
const unmappedSkus = (...args: Parameters<typeof askAbout>) =>
  askAbout(...args).map((sku) => sku.sourceSku);

describe("amazonZohoInvoiceModule.unmappedSkus", () => {
  it("flags a SKU that would invoice but has no mapping row", () => {
    expect(unmappedSkus([row({ sku: "UNMAPPED-1" })], emptyRules)).toEqual(["UNMAPPED-1"]);
  });

  it("does not flag a SKU that is already mapped", () => {
    const rules: RulesSnapshot = {
      ...emptyRules,
      skuMappings: [
        { channel: "amazon", sourceSku: "MAPPED-1", sourceName: "", targetSku: "TS-1", itemName: "Widget", isIgnored: false },
      ],
    };

    expect(unmappedSkus([row({ sku: "MAPPED-1" })], rules)).toEqual([]);
  });

  it("does not flag a SKU that is explicitly ignored", () => {
    const rules: RulesSnapshot = {
      ...emptyRules,
      skuMappings: [
        { channel: "amazon", sourceSku: "IGNORED-1", sourceName: "", targetSku: null, itemName: null, isIgnored: true },
      ],
    };

    expect(unmappedSkus([row({ sku: "IGNORED-1" })], rules)).toEqual([]);
  });

  it("only looks at the amazon channel's mapping, not another channel's row for the same code", () => {
    const rules: RulesSnapshot = {
      ...emptyRules,
      skuMappings: [
        { channel: "allegro", sourceSku: "SHARED-1", sourceName: "", targetSku: "AL-1", itemName: "Widget", isIgnored: false },
      ],
    };

    expect(unmappedSkus([row({ sku: "SHARED-1" })], rules)).toEqual(["SHARED-1"]);
  });

  it("ignores rows that would never invoice anyway, unmapped or not", () => {
    const rows = [
      row({ sku: "ZERO-QTY", quantity: new Decimal(0) }),
      row({ sku: "NO-QTY", quantity: null }),
      row({ sku: "ZERO-SALE", netAmount: new Decimal(0) }),
      row({ sku: "NO-SALE", netAmount: null }),
      row({ sku: "REFUND", transactionType: "Rückerstattung" }),
      row({ sku: "NO-COUNTRY", countryCode: null }),
      row({ sku: null }),
      row({ sku: "  ", quantity: new Decimal(1) }),
      row({ sku: "OTHER-CHANNEL", dataset: "allegro" }),
    ];

    expect(unmappedSkus(rows, emptyRules)).toEqual([]);
  });

  it("de-duplicates repeats and returns them sorted", () => {
    const rows = [row({ sku: "B-SKU" }), row({ sku: "A-SKU" }), row({ sku: "B-SKU" })];

    expect(unmappedSkus(rows, emptyRules)).toEqual(["A-SKU", "B-SKU"]);
  });
});
