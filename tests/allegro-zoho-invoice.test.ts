import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import { ALLEGRO_CURRENCY_MAP } from "@/modules/channels/allegro";
import { allegroZohoInvoiceModule, generateAllegroZohoInvoice } from "@/modules/reports/allegro-zoho-invoice";

import type { FxSnapshot, LedgerRow, ReportContext, RulesSnapshot } from "@/lib/reports/types";

/**
 * Numbers throughout are chosen so every division lands on an exact cent —
 * gross = net × 1.23 (PLN) or × 1.21 (CZK) — so the expected values below are
 * arithmetic, not approximations, and a real rounding regression cannot hide
 * behind "close enough".
 */

let nextId = 0;

function row(overrides: Partial<LedgerRow> & { raw: Record<string, string> }): LedgerRow {
  nextId += 1;

  return {
    id: `row-${nextId}`,
    dataset: "allegro",
    channel: "allegro",
    countryCode: "PL",
    occurredOn: "2026-01-15",
    transactionType: "wpłata",
    currency: "PLN",
    gross: new Decimal(0),
    vatAmount: null,
    netAmount: null,
    sku: null,
    quantity: null,
    sourceFileId: "file-1",
    sourceRowNumber: nextId,
    ...overrides,
    raw: { kupujący: "buyer;Name;Street;12-345 City", operacja: "wpłata", ...overrides.raw },
  };
}

const rules: RulesSnapshot = {
  vatRates: [
    { country: "PL", rate: "23", validFrom: "2020-01-01", validTo: null },
    { country: "CZ", rate: "21", validFrom: "2020-01-01", validTo: null },
    { country: "HU", rate: "27", validFrom: "2020-01-01", validTo: null },
  ],
  sellerVatNumbers: [],
  skuMappings: [
    { channel: "allegro", sourceSku: "111", targetSku: "ZOHO-A", itemName: "Widget A", isIgnored: false },
    { channel: "allegro", sourceSku: "222", targetSku: "ZOHO-B", itemName: "Widget B", isIgnored: false },
    { channel: "allegro", sourceSku: "333", targetSku: null, itemName: null, isIgnored: true },
  ],
  channelRules: [{ channel: "allegro", key: "currency_map", value: ALLEGRO_CURRENCY_MAP }],
};

// Euros per unit of the currency — the same (already-inverted) convention
// `euroRateOn` returns, so a euro amount is native × rate, not native ÷ rate.
const fx: FxSnapshot = {
  PLN: { rate: "0.25", rateDate: "2026-01-31", source: "ecb" },
  CZK: { rate: "0.04", rateDate: "2026-01-31", source: "ecb" },
};

const context: ReportContext = {
  period: { label: "2026.01 January", granularity: "month", start: "2026-01-01", end: "2026-01-31" },
  rules,
  fx,
};

describe("generateAllegroZohoInvoice", () => {
  it("splits a mixed order by list price, collapses by SKU across currencies, and buckets VAT by scheme", () => {
    const rows: LedgerRow[] = [
      // Establishes list_price(111, PLN) = 123.00
      row({ gross: new Decimal("123.00"), raw: { oferta: "111;Widget A;1 szt.", dostawa: "0.00 zł", kwota: "123.00 zł" } }),
      // Establishes list_price(222, PLN) = 246.00
      row({ gross: new Decimal("246.00"), raw: { oferta: "222;Widget B;1 szt.", dostawa: "0.00 zł", kwota: "246.00 zł" } }),
      // Mixed order: splits exactly 123.00 / 246.00 by list price (369 = 123 + 246, no rounding remainder).
      row({
        gross: new Decimal("369.00"),
        raw: {
          oferta: "111;Widget A;1 szt.|222;Widget B;1 szt.",
          dostawa: "12.00 zł",
          kwota: "369.00 zł",
        },
      }),
      // A different currency, same SKU: collapses into the same output row as the PLN Cartridge lines.
      row({
        currency: "CZK",
        countryCode: "CZ",
        gross: new Decimal("363.00"),
        raw: { oferta: "111;Widget A;3 szt.", dostawa: "0.00 zł", kwota: "363.00 Kč" },
      }),
      // Ignored SKU: dropped from the product lines, but its VAT still counts.
      row({
        gross: new Decimal("123.00"),
        raw: { oferta: "333;Bundle;1 szt.", dostawa: "0.00 zł", kwota: "123.00 zł" },
      }),
      // Not a sale: no buyer, so it is a fee and must not appear anywhere in the output.
      row({
        raw: { kupujący: "", operacja: "pobranie opłat ze środków", kwota: "-5.00 zł" },
        gross: new Decimal("-5.00"),
      }),
    ];

    const result = generateAllegroZohoInvoice(rows, context);

    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].rows).toEqual([
      ["2026-01-31 00:00:00", "INV-Allegro-01.26", "Allegro", "EUR", "1", "Widget A", "ZOHO-A", "", "5", "12.40", "Allegro Sales"],
      ["2026-01-31 00:00:00", "INV-Allegro-01.26", "Allegro", "EUR", "1", "Widget B", "ZOHO-B", "", "2", "50.00", "Allegro Sales"],
      [
        "2026-01-31 00:00:00",
        "INV-Allegro-01.26",
        "Allegro",
        "EUR",
        "1",
        "",
        "",
        "VAT PL Regular",
        "1",
        "40.25",
        "VAT PL Regular",
      ],
      [
        "2026-01-31 00:00:00",
        "INV-Allegro-01.26",
        "Allegro",
        "EUR",
        "1",
        "",
        "",
        "VAT OSS Other countries",
        "1",
        "2.52",
        "VAT OSS Other countries",
      ],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("omits a VAT bucket that nothing sold under this period, rather than printing zero", () => {
    const rows: LedgerRow[] = [
      row({ gross: new Decimal("123.00"), raw: { oferta: "111;Widget A;1 szt.", dostawa: "0.00 zł", kwota: "123.00 zł" } }),
    ];

    const result = generateAllegroZohoInvoice(rows, context);
    const vatLines = result.sheets[0].rows.filter((r) => String(r[7]).startsWith("VAT"));

    expect(vatLines).toEqual([
      ["2026-01-31 00:00:00", "INV-Allegro-01.26", "Allegro", "EUR", "1", "", "", "VAT PL Regular", "1", "5.75", "VAT PL Regular"],
    ]);
  });

  it("refuses the whole build when a currency it needs to convert has no cached exchange rate", () => {
    const rows: LedgerRow[] = [
      row({ gross: new Decimal("123.00"), raw: { oferta: "111;Widget A;1 szt.", dostawa: "0.00 zł", kwota: "123.00 zł" } }),
    ];
    const noFxContext: ReportContext = { ...context, fx: {} };

    expect(() => generateAllegroZohoInvoice(rows, noFxContext)).toThrow(/PLN exchange rate/);
  });

  it("refuses when a bad exchange rate would blow the total far past a sane bound", () => {
    // This is the actual production incident: a currency far from 1 (HUF's
    // real rate is roughly 0.0026 EUR per HUF) combined with a rate applied
    // the wrong way inflated the total by orders of magnitude. The sanity
    // check here doesn't know or care *why* the rate is wrong — a raw,
    // un-inverted "378" is exactly the kind of value that class of bug (or a
    // bad cached rate) would produce — it just refuses a total that could
    // not possibly be right.
    const rows: LedgerRow[] = [
      row({
        currency: "HUF",
        countryCode: "HU",
        gross: new Decimal("12690.00"),
        raw: { oferta: "111;Widget A;1 szt.", dostawa: "0.00 zł", kwota: "12690.00 Ft" },
      }),
    ];
    const badRateContext: ReportContext = {
      ...context,
      fx: { HUF: { rate: "378", rateDate: "2026-01-31", source: "ecb" } },
    };

    expect(() => generateAllegroZohoInvoice(rows, badRateContext)).toThrow(/more than 5x/);
  });

  it("splits an unequal multi-item order proportionally and reconciles to the cent", () => {
    const rows: LedgerRow[] = [
      row({ gross: new Decimal("100.00"), raw: { oferta: "111;Widget A;1 szt.", dostawa: "0.00 zł", kwota: "100.00 zł" } }),
      row({ gross: new Decimal("200.00"), raw: { oferta: "222;Widget B;1 szt.", dostawa: "0.00 zł", kwota: "200.00 zł" } }),
      // list_price A=100, B=200 -> shares of 77.00 are 25.67 and the remainder 51.33 — not a round split,
      // which is the point: a naive 50/50 or equal-thirds split would land on different, wrong totals.
      row({
        gross: new Decimal("77.00"),
        raw: { oferta: "111;Widget A;1 szt.|222;Widget B;1 szt.", dostawa: "0.00 zł", kwota: "77.00 zł" },
      }),
    ];

    const result = generateAllegroZohoInvoice(rows, {
      ...context,
      fx: { PLN: { rate: "1", rateDate: "2026-01-31", source: "ecb" } },
    });

    const sku = new Map(result.sheets[0].rows.map((r) => [r[6], r]));

    // A: (100.00 + 25.67) gross across two lines, each split at 23% VAT and summed net; same for B.
    expect(sku.get("ZOHO-A")?.[8]).toBe("2");
    expect(sku.get("ZOHO-A")?.[9]).toBe("51.09");
    expect(sku.get("ZOHO-B")?.[8]).toBe("2");
    expect(sku.get("ZOHO-B")?.[9]).toBe("102.17");

    const vatRow = result.sheets[0].rows.find((r) => r[7] === "VAT PL Regular");

    expect(vatRow?.[9]).toBe("70.50");
  });
});

describe("allegroZohoInvoiceModule.unmappedSkus", () => {
  it("flags an offer id that would invoice but has no mapping row", () => {
    const rows: LedgerRow[] = [
      row({ gross: new Decimal("1"), raw: { oferta: "999;Thing;1 szt." } }),
    ];

    expect(allegroZohoInvoiceModule.unmappedSkus!(rows, rules)).toEqual(["999"]);
  });

  it("does not flag a mapped or an ignored SKU", () => {
    const rows: LedgerRow[] = [
      row({ gross: new Decimal("1"), raw: { oferta: "111;Widget A;1 szt.|333;Bundle;1 szt." } }),
    ];

    expect(allegroZohoInvoiceModule.unmappedSkus!(rows, rules)).toEqual([]);
  });

  it("ignores a row that is not a wpłata sale", () => {
    const rows: LedgerRow[] = [
      row({
        gross: new Decimal("1"),
        raw: { kupujący: "", operacja: "zwrot", oferta: "999;Thing;1 szt." },
      }),
    ];

    expect(allegroZohoInvoiceModule.unmappedSkus!(rows, rules)).toEqual([]);
  });
});

describe("allegroZohoInvoiceModule.unmappedCurrencies", () => {
  it("flags a settlement currency with no currency_map rule", () => {
    const rows: LedgerRow[] = [row({ currency: "RON", gross: new Decimal("1"), raw: {} })];

    expect(allegroZohoInvoiceModule.unmappedCurrencies!(rows, rules)).toEqual(["RON"]);
  });

  it("does not flag an already-mapped currency", () => {
    const rows: LedgerRow[] = [row({ currency: "PLN", gross: new Decimal("1"), raw: {} })];

    expect(allegroZohoInvoiceModule.unmappedCurrencies!(rows, rules)).toEqual([]);
  });

  it("prices a SKU from an earlier month when this month never sold it alone", () => {
    // Ivan buys a filter and a cartridge together, and the filter never sold on
    // its own in January. It used to go to Zoho at 0.00 while its money was
    // billed under the cartridge; December's price answers instead.
    const history: LedgerRow[] = [
      row({
        occurredOn: "2025-12-10",
        gross: new Decimal("400.00"),
        raw: { oferta: "111;Filter;1 szt.", dostawa: "0.00 zł", kwota: "400.00 zł" },
      }),
    ];

    const rows: LedgerRow[] = [
      row({ gross: new Decimal("100.00"), raw: { oferta: "222;Cartridge;1 szt.", dostawa: "0.00 zł", kwota: "100.00 zł" } }),
      row({ gross: new Decimal("500.00"), raw: { oferta: "111;Filter;1 szt.|222;Cartridge;1 szt.", dostawa: "0.00 zł", kwota: "500.00 zł" } }),
    ];

    const result = generateAllegroZohoInvoice(rows, { ...context, history });
    const bySku = new Map(
      result.sheets[0].rows.filter((r) => !String(r[7]).startsWith("VAT")).map((r) => [r[6], r]),
    );

    // The 500 order splits 400:100 on December's price, so the filter carries
    // 400 zł gross and the cartridge 200 across its two units — net of 23% VAT
    // and at 0.25 EUR/PLN, 81.30 for one and 20.33 each for two.
    expect(bySku.get("ZOHO-A")?.slice(8, 10)).toEqual(["1", "81.30"]);
    expect(bySku.get("ZOHO-B")?.slice(8, 10)).toEqual(["2", "20.33"]);
    expect(result.warnings.some((w) => w.includes("111") && w.includes("2025-12"))).toBe(true);
  });

  it("splits by quantity, never by zero, when no month knows a price for one of the SKUs", () => {
    const rows: LedgerRow[] = [
      row({ gross: new Decimal("100.00"), raw: { oferta: "222;Cartridge;1 szt.", dostawa: "0.00 zł", kwota: "100.00 zł" } }),
      row({ gross: new Decimal("500.00"), raw: { oferta: "111;Filter;1 szt.|222;Cartridge;1 szt.", dostawa: "0.00 zł", kwota: "500.00 zł" } }),
    ];

    const result = generateAllegroZohoInvoice(rows, context);
    const products = result.sheets[0].rows.filter((r) => !String(r[7]).startsWith("VAT"));

    // Whatever the split, no line may be priced at nothing: a zero line in Zoho
    // is a product billed for free and its money charged to another SKU.
    expect(products.length).toBeGreaterThan(1);
    for (const line of products) expect(Number(line[9])).toBeGreaterThan(0);
  });

});
