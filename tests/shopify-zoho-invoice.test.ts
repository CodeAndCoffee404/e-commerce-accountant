import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  generateShopifyZohoInvoice,
  shopifyZohoInvoiceModule,
} from "@/modules/reports/shopify-zoho-invoice";

import type { FxSnapshot, LedgerRow, ReportContext, RulesSnapshot } from "@/lib/reports/types";

/**
 * Fixture numbers are the real Geyser Shopify orders for January 2026 (the
 * upload the ТЗ discussion was built from) and the real Zoho invoice that
 * shipped for that month — 8 orders, subtotal €662.00, VAT €111.83, total
 * €773.83. What changes here is only how the VAT is bucketed: the shipped
 * invoice grouped Austria under "DE" and Slovenia under "FR", confirmed in
 * that discussion to be a manual mistake rather than a rule, so this test
 * expects the corrected buckets (Austria and Slovenia both fall to "Other
 * countries") while the grand totals still reconcile to the same invoice.
 */

let nextId = 0;

function row(overrides: Partial<LedgerRow> & { raw: Record<string, string> }): LedgerRow {
  nextId += 1;

  return {
    id: `row-${nextId}`,
    dataset: "shopify_geyser",
    channel: "shopify_geyser",
    countryCode: null,
    occurredOn: "2026-01-15",
    transactionType: "paid",
    currency: "EUR",
    gross: new Decimal(0),
    vatAmount: null,
    netAmount: null,
    sku: null,
    quantity: new Decimal(1),
    sourceFileId: "file-1",
    sourceRowNumber: nextId,
    ...overrides,
    raw: { ...overrides.raw },
  };
}

/** The first line of an order: carries the order-level columns. */
function orderHead(args: {
  name: string;
  country: string;
  total: string;
  taxes: string;
  taxLabel: string;
  itemName: string;
  price: string;
  qty: number;
  occurredOn?: string;
  source?: string;
}): LedgerRow {
  return row({
    countryCode: args.country,
    occurredOn: args.occurredOn ?? "2026-01-15",
    quantity: new Decimal(args.qty),
    gross: new Decimal(args.price).times(args.qty),
    raw: {
      Name: args.name,
      Total: args.total,
      Taxes: args.taxes,
      "Tax 1 Name": args.taxLabel,
      "Shipping Country": args.country,
      Source: args.source ?? "web",
      "Lineitem name": args.itemName,
      "Lineitem price": args.price,
    },
  });
}

/** A continuation line of an order that already has a head row above. */
function orderLine(args: {
  name: string;
  itemName: string;
  price: string;
  qty: number;
  occurredOn?: string;
}): LedgerRow {
  return row({
    countryCode: null,
    occurredOn: args.occurredOn ?? "2026-01-15",
    quantity: new Decimal(args.qty),
    gross: new Decimal(args.price).times(args.qty),
    raw: {
      Name: args.name,
      "Lineitem name": args.itemName,
      "Lineitem price": args.price,
    },
  });
}

const rules: RulesSnapshot = {
  vatRates: [
    { country: "FR", rate: "20", validFrom: "2020-01-01", validTo: null },
    { country: "AT", rate: "20", validFrom: "2020-01-01", validTo: null },
    { country: "ES", rate: "21", validFrom: "2020-01-01", validTo: null },
    { country: "SI", rate: "22", validFrom: "2020-01-01", validTo: null },
  ],
  sellerVatNumbers: [],
  skuMappings: [
    { channel: "shopify_geyser", sourceSku: "Geyser EURO Cartridge - 1 Cartridge", sourceName: "Geyser EURO Cartridge - 1 Cartridge", targetSku: "CART-1", itemName: "Geyser Euro Cartridge", isIgnored: false },
    { channel: "shopify_geyser", sourceSku: "Geyser EURO Cartridge - 2 Cartridges", sourceName: "Geyser EURO Cartridge - 2 Cartridges", targetSku: "CART-2", itemName: "Geyser Euro Cartridge 2-Pack", isIgnored: false },
    { channel: "shopify_geyser", sourceSku: "Geyser EURO Cartridge - 4 Cartridges", sourceName: "Geyser EURO Cartridge - 4 Cartridges", targetSku: "CART-4", itemName: "Geyser Euro Cartridge 4-Pack", isIgnored: false },
    { channel: "shopify_geyser", sourceSku: "Geyser EURO Kit - +1 Cartridge", sourceName: "Geyser EURO Kit - +1 Cartridge", targetSku: "FILTER-KIT", itemName: "Geyser Euro Filter", isIgnored: false },
    { channel: "shopify_geyser", sourceSku: "Geyser EURO Filter", sourceName: "Geyser EURO Filter", targetSku: "FILTER", itemName: "Geyser Euro Filter Only", isIgnored: false },
  ],
  channelRules: [
    {
      channel: "shopify_geyser",
      key: "defaults",
      value: {
        departureCountry: "ES",
        domesticScheme: "REGULAR",
        domesticSellerVat: "ESN0531416F",
        exportScheme: "UNION-OSS",
        exportSellerVat: "EE102013089",
      },
    },
    { channel: "shopify_geyser", key: "skipped_arrival_countries", value: ["CH"] },
    { channel: "shopify_geyser", key: "country_aliases", value: { UK: "GB" } },
    { channel: "shopify_geyser", key: "recompute_zero_tax_countries", value: ["GB"] },
    { channel: "shopify_geyser", key: "excluded_sources", value: ["shopify_draft_order"] },
  ],
};

const fx: FxSnapshot = {};

const context: ReportContext = {
  period: { label: "2026.01 January", granularity: "month", start: "2026-01-01", end: "2026-01-31" },
  rules,
  fx,
};

/** The 8 real January orders, in the shape the ledger stores them. */
function januaryRows(): LedgerRow[] {
  return [
    orderHead({
      name: "#171112",
      country: "FR",
      total: "135.80",
      taxes: "22.63",
      taxLabel: "FR TVA 20%",
      itemName: "Geyser EURO Cartridge - 1 Cartridge",
      price: "45.90",
      qty: 1,
    }),
    orderLine({ name: "#171112", itemName: "Geyser EURO Filter", price: "89.90", qty: 1 }),
    orderHead({
      name: "#171111",
      country: "AT",
      total: "123.90",
      taxes: "20.65",
      taxLabel: "AT VAT 20%",
      itemName: "Geyser EURO Cartridge - 4 Cartridges",
      price: "123.90",
      qty: 1,
    }),
    orderHead({
      name: "#171110",
      country: "FR",
      total: "45.90",
      taxes: "7.65",
      taxLabel: "FR TVA 20%",
      itemName: "Geyser EURO Kit - +1 Cartridge",
      price: "45.90",
      qty: 1,
    }),
    orderHead({
      name: "#171109",
      country: "FR",
      total: "91.80",
      taxes: "15.30",
      taxLabel: "FR TVA 20%",
      itemName: "Geyser EURO Cartridge - 1 Cartridge",
      price: "45.90",
      qty: 2,
    }),
    orderHead({
      name: "#171108",
      country: "ES",
      total: "72.90",
      taxes: "12.65",
      taxLabel: "ES IVA 21%",
      itemName: "Geyser EURO Cartridge - 2 Cartridges",
      price: "72.90",
      qty: 1,
    }),
    orderHead({
      name: "#171107",
      country: "FR",
      total: "45.90",
      taxes: "7.65",
      taxLabel: "FR TVA 20%",
      itemName: "Geyser EURO Kit - +1 Cartridge",
      price: "45.90",
      qty: 1,
    }),
    orderHead({
      name: "#171106",
      country: "SI",
      total: "72.90",
      taxes: "13.15",
      taxLabel: "SI VAT 22%",
      itemName: "Geyser EURO Cartridge - 2 Cartridges",
      price: "72.90",
      qty: 1,
    }),
    orderHead({
      name: "#171105",
      country: "AT",
      total: "72.90",
      taxes: "12.15",
      taxLabel: "AT VAT 20%",
      itemName: "Geyser EURO Cartridge - 2 Cartridges",
      price: "72.90",
      qty: 1,
    }),
  ];
}

describe("generateShopifyZohoInvoice", () => {
  it("aggregates every line item by (SKU, unit price), one row per item — no combo collapsing", () => {
    const result = generateShopifyZohoInvoice(januaryRows(), context);
    const products = result.sheets[0].rows.filter((r) => r[10] === "Shopify Sales");
    const bySku = new Map(products.map((r) => [r[6], r]));

    expect(bySku.get("CART-1")).toEqual([
      "2026-01-31 00:00:00", "INV-GeyserWebsite-01.26", "Geyser Website", "EUR", "1",
      "Geyser Euro Cartridge", "CART-1", "", "3", "45.90", "Shopify Sales",
    ]);
    expect(bySku.get("CART-2")).toEqual([
      "2026-01-31 00:00:00", "INV-GeyserWebsite-01.26", "Geyser Website", "EUR", "1",
      "Geyser Euro Cartridge 2-Pack", "CART-2", "", "3", "72.90", "Shopify Sales",
    ]);
    expect(bySku.get("CART-4")).toEqual([
      "2026-01-31 00:00:00", "INV-GeyserWebsite-01.26", "Geyser Website", "EUR", "1",
      "Geyser Euro Cartridge 4-Pack", "CART-4", "", "1", "123.90", "Shopify Sales",
    ]);
    expect(bySku.get("FILTER-KIT")).toEqual([
      "2026-01-31 00:00:00", "INV-GeyserWebsite-01.26", "Geyser Website", "EUR", "1",
      "Geyser Euro Filter", "FILTER-KIT", "", "2", "45.90", "Shopify Sales",
    ]);
    // The order #171112 "Filter" line stays its own product row — no combo
    // collapsing into "Filter with 1 extra Cartridge", confirmed out of scope.
    expect(bySku.get("FILTER")).toEqual([
      "2026-01-31 00:00:00", "INV-GeyserWebsite-01.26", "Geyser Website", "EUR", "1",
      "Geyser Euro Filter Only", "FILTER", "", "1", "89.90", "Shopify Sales",
    ]);
    expect(products).toHaveLength(5);

    // Reconciles to the real invoice's subtotal.
    const subtotal = products.reduce(
      (sum, r) => sum.plus(new Decimal(String(r[8])).times(new Decimal(String(r[9])))),
      new Decimal(0),
    );
    expect(subtotal.toFixed(2)).toBe("662.00");
  });

  it("buckets VAT by market: Spain domestic, DE/FR/IT/PL each their own OSS line, the rest pooled", () => {
    const result = generateShopifyZohoInvoice(januaryRows(), context);
    const vatLines = result.sheets[0].rows.filter((r) => String(r[7]).startsWith("VAT"));

    expect(vatLines).toEqual([
      [
        "2026-01-31 00:00:00", "INV-GeyserWebsite-01.26", "Geyser Website", "EUR", "1",
        "", "", "VAT ES Regular", "1", "12.65", "VAT ES Regular",
      ],
      [
        "2026-01-31 00:00:00", "INV-GeyserWebsite-01.26", "Geyser Website", "EUR", "1",
        "", "", "VAT FR OSS", "1", "53.23", "VAT FR OSS",
      ],
      [
        "2026-01-31 00:00:00", "INV-GeyserWebsite-01.26", "Geyser Website", "EUR", "1",
        // Austria (32.80) and Slovenia (13.15) are neither Spain nor a
        // breakout market — both pool here, not into FR/DE as the legacy
        // manual invoice once did.
        "", "", "VAT OSS Other countries", "1", "45.95", "VAT OSS Other countries",
      ],
    ]);

    // Reconciles to the real invoice's VAT total.
    const vatTotal = vatLines.reduce((sum, r) => sum.plus(new Decimal(String(r[9]))), new Decimal(0));
    expect(vatTotal.toFixed(2)).toBe("111.83");
  });

  it("omits a VAT bucket nothing sold under this period, rather than printing zero", () => {
    const rows = [
      orderHead({
        name: "#1",
        country: "ES",
        total: "100.00",
        taxes: "17.36",
        taxLabel: "ES IVA 21%",
        itemName: "Geyser EURO Cartridge - 1 Cartridge",
        price: "100.00",
        qty: 1,
      }),
    ];
    const result = generateShopifyZohoInvoice(rows, context);
    const vatLines = result.sheets[0].rows.filter((r) => String(r[7]).startsWith("VAT"));

    expect(vatLines).toEqual([
      [
        "2026-01-31 00:00:00", "INV-GeyserWebsite-01.26", "Geyser Website", "EUR", "1",
        "", "", "VAT ES Regular", "1", "17.36", "VAT ES Regular",
      ],
    ]);
  });

  it("drops a draft order's line items entirely, even the continuation lines the source column is blank on", () => {
    const rows = [
      orderHead({
        name: "#999",
        country: "FR",
        total: "50.00",
        taxes: "8.33",
        taxLabel: "FR TVA 20%",
        itemName: "Geyser EURO Cartridge - 1 Cartridge",
        price: "50.00",
        qty: 1,
        source: "shopify_draft_order",
      }),
      orderLine({ name: "#999", itemName: "Geyser EURO Filter", price: "10.00", qty: 1 }),
    ];

    const result = generateShopifyZohoInvoice(rows, context);

    expect(result.sheets[0].rows).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toContain("Shopify invoice: draft order");
    // Both lines of the draft order were dropped, not just the first.
    expect(result.skipped.find((s) => s.reason === "Shopify invoice: draft order")?.count).toBe(2);
  });

  it("drops an order shipped to Switzerland", () => {
    const rows = [
      orderHead({
        name: "#1",
        country: "CH",
        total: "50.00",
        taxes: "0.00",
        taxLabel: "",
        itemName: "Geyser EURO Cartridge - 1 Cartridge",
        price: "50.00",
        qty: 1,
      }),
    ];

    const result = generateShopifyZohoInvoice(rows, context);

    expect(result.sheets[0].rows).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toContain("Shopify invoice: delivered to CH");
  });

  it("skips an ignored SKU's product line but still counts its VAT", () => {
    const ignoredRules: RulesSnapshot = {
      ...rules,
      skuMappings: [
        ...rules.skuMappings.filter((m) => m.sourceSku !== "Geyser EURO Cartridge - 4 Cartridges"),
        { channel: "shopify_geyser", sourceSku: "Geyser EURO Cartridge - 4 Cartridges", sourceName: "Geyser EURO Cartridge - 4 Cartridges", targetSku: null, itemName: null, isIgnored: true },
      ],
    };
    const rows = [
      orderHead({
        name: "#1",
        country: "FR",
        total: "100.00",
        taxes: "16.67",
        taxLabel: "FR TVA 20%",
        itemName: "Geyser EURO Cartridge - 4 Cartridges",
        price: "100.00",
        qty: 1,
      }),
    ];

    const result = generateShopifyZohoInvoice(rows, { ...context, rules: ignoredRules });

    expect(result.sheets[0].rows.filter((r) => r[10] === "Shopify Sales")).toEqual([]);
    const vatLine = result.sheets[0].rows.find((r) => r[7] === "VAT FR OSS");
    expect(vatLine?.[9]).toBe("16.67");
  });

  it("refuses to build when the shopify_geyser/defaults channel rule is missing", () => {
    const noDefaultsContext: ReportContext = {
      ...context,
      rules: { ...rules, channelRules: rules.channelRules.filter((r) => r.key !== "defaults") },
    };

    expect(() => generateShopifyZohoInvoice(januaryRows(), noDefaultsContext)).toThrow(/defaults channel rule/);
  });
});

describe("shopifyZohoInvoiceModule.unmappedSkus", () => {
  it("flags a line item name that would invoice but has no mapping row", () => {
    const rows = [
      orderHead({
        name: "#1",
        country: "FR",
        total: "10.00",
        taxes: "1.67",
        taxLabel: "FR TVA 20%",
        itemName: "Geyser EURO New Thing",
        price: "10.00",
        qty: 1,
      }),
    ];

    expect(shopifyZohoInvoiceModule.unmappedSkus!(rows, rules)).toEqual([
      {
        key: "Geyser EURO New Thing\u0000Geyser EURO New Thing",
        sourceSku: "Geyser EURO New Thing",
        sourceName: "Geyser EURO New Thing",
        problem: "unmapped",
        expectedNames: [],
      },
    ]);
  });

  it("does not flag a mapped item, and ignores a draft order's items", () => {
    const rows = [
      orderHead({
        name: "#1",
        country: "FR",
        total: "45.90",
        taxes: "7.65",
        taxLabel: "FR TVA 20%",
        itemName: "Geyser EURO Cartridge - 1 Cartridge",
        price: "45.90",
        qty: 1,
      }),
      orderHead({
        name: "#2",
        country: "FR",
        total: "10.00",
        taxes: "1.67",
        taxLabel: "FR TVA 20%",
        itemName: "Geyser EURO Draft Thing",
        price: "10.00",
        qty: 1,
        source: "shopify_draft_order",
      }),
    ];

    expect(shopifyZohoInvoiceModule.unmappedSkus!(rows, rules)).toEqual([]);
  });
});
