import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import type { LedgerRow } from "@/lib/reports/types";
import type { Period } from "@/lib/ingest/period";

import { generateZohoInvoice, invoiceNumber, ZOHO_HEADERS } from "./amazon-zoho-invoice";
import { GEYSER } from "@/modules/companies/geyser";

const PERIOD: Period = {
  label: "2026.06 June",
  granularity: "month",
  start: "2026-06-01",
  end: "2026-06-30",
};

const RULES = { vatRates: [], sellerVatNumbers: [], skuMappings: [], channelRules: [] };

function saleRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: "sale",
    dataset: "amazon_monthly",
    channel: "amazon",
    countryCode: "DE",
    occurredOn: "2026-06-15",
    transactionType: "Bestellung",
    currency: "EUR",
    gross: null,
    vatAmount: null,
    netAmount: new Decimal("10"),
    sku: "SKU-1",
    quantity: new Decimal(1),
    sourceFileId: "file-monthly",
    sourceRowNumber: 1,
    raw: {},
    ...overrides,
  };
}

function vatRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: "vat",
    dataset: "amazon_vat",
    channel: "amazon",
    countryCode: "DE",
    occurredOn: "2026-06-15",
    transactionType: "SALE",
    currency: "EUR",
    gross: null,
    vatAmount: null,
    netAmount: null,
    sku: "SKU-1",
    quantity: new Decimal(1),
    sourceFileId: "file-vat",
    sourceRowNumber: 1,
    raw: {
      MARKETPLACE: "amazon.de",
      TAX_REPORTING_SCHEME: "REGULAR",
      TOTAL_ACTIVITY_VALUE_VAT_AMT: "1.90",
    },
    ...overrides,
  };
}

function oss(marketplace: string, arrival: string, amount: string): LedgerRow {
  return vatRow({
    raw: {
      MARKETPLACE: marketplace,
      TAX_REPORTING_SCHEME: "UNION-OSS",
      SALE_ARRIVAL_COUNTRY: arrival,
      TRANSACTION_CURRENCY_CODE: "EUR",
      TOTAL_ACTIVITY_VALUE_VAT_AMT: amount,
    },
  });
}

function generate(rows: LedgerRow[]) {
  return generateZohoInvoice(rows, { period: PERIOD, rules: RULES, fx: {}, company: GEYSER });
}

const HEADER = {
  itemDesc: ZOHO_HEADERS.indexOf("Item Desc"),
  quantity: ZOHO_HEADERS.indexOf("Quantity"),
  itemPrice: ZOHO_HEADERS.indexOf("Item Price"),
  account: ZOHO_HEADERS.indexOf("Account"),
  invoiceNumber: ZOHO_HEADERS.indexOf("Invoice Number"),
  invoiceDate: ZOHO_HEADERS.indexOf("Invoice Date"),
  customerName: ZOHO_HEADERS.indexOf("Customer Name"),
  currency: ZOHO_HEADERS.indexOf("Currency Code"),
  rate: ZOHO_HEADERS.indexOf("Exchange Rate"),
};

function vatLinesOf(result: ReturnType<typeof generate>, country: string) {
  const number = invoiceNumber(GEYSER.amazon!.invoicePrefix, country, PERIOD.end);

  return result.sheets[0].rows.filter(
    (row) => row[HEADER.invoiceNumber] === number && row[HEADER.account] !== `Amazon Sales ${country}`,
  );
}

describe("VAT lines on the Amazon invoice for Zoho", () => {
  it("bills REGULAR on the invoice of the country the goods arrived in", () => {
    const rows = [
      saleRow({ countryCode: "DE" }),
      saleRow({ countryCode: "IT", transactionType: "Ordine", sku: "SKU-2" }),
      // Sold on amazon.de, delivered to Italy: the tax is Italy's, and it is
      // the Italian invoice that has to carry it.
      vatRow({
        raw: {
          MARKETPLACE: "amazon.de",
          TAX_REPORTING_SCHEME: "REGULAR",
          SALE_ARRIVAL_COUNTRY: "IT",
          TRANSACTION_CURRENCY_CODE: "EUR",
          TOTAL_ACTIVITY_VALUE_VAT_AMT: "9.83",
        },
      }),
      vatRow({
        raw: {
          MARKETPLACE: "amazon.de",
          TAX_REPORTING_SCHEME: "REGULAR",
          SALE_ARRIVAL_COUNTRY: "DE",
          TRANSACTION_CURRENCY_CODE: "EUR",
          TOTAL_ACTIVITY_VALUE_VAT_AMT: "1.90",
        },
      }),
    ];

    const result = generate(rows);

    expect(vatLinesOf(result, "IT").map((row) => [row[HEADER.itemDesc], row[HEADER.itemPrice]])).toEqual([
      ["VAT IT Regular", "9.83"],
    ]);
    expect(vatLinesOf(result, "DE").map((row) => [row[HEADER.itemDesc], row[HEADER.itemPrice]])).toEqual([
      ["VAT DE Regular", "1.90"],
    ]);
  });

  it("splits OSS by arrival country, on the marketplace's own invoice", () => {
    const rows = [
      saleRow({ countryCode: "FR", transactionType: "Commande" }),
      oss("amazon.fr", "FR", "4488.71"),
      // Spain is broken out by name; Belgium and Malta are not, so they pool.
      oss("amazon.fr", "ES", "12.00"),
      oss("amazon.fr", "BE", "55.67"),
      oss("amazon.fr", "MT", "8.73"),
    ];

    const lines = vatLinesOf(generate(rows), "FR");

    expect(lines.map((row) => [row[HEADER.itemDesc], row[HEADER.itemPrice]])).toEqual([
      ["VAT ES OSS", "12.00"],
      ["VAT FR OSS", "4488.71"],
      ["VAT OSS Other countries", "64.40"],
    ]);

    // The account carries the tax's own country, not the invoice's, so one
    // country's OSS lands on one Zoho account across every marketplace.
    expect(lines[0][HEADER.account]).toBe("VAT ES OSS");
  });

  it("names both schemes the way the Zoho accounts are named", () => {
    // `VAT FR Regular` and `VAT FR OSS` — country in the middle, scheme last,
    // that capitalisation. These strings are account names in Zoho, not
    // labels: a line that does not match one lands nowhere, so they are
    // asserted character for character, in the description and the account
    // alike.
    const rows = [
      saleRow({ countryCode: "FR", transactionType: "Commande" }),
      vatRow({
        raw: {
          MARKETPLACE: "amazon.fr",
          TAX_REPORTING_SCHEME: "REGULAR",
          SALE_ARRIVAL_COUNTRY: "FR",
          TRANSACTION_CURRENCY_CODE: "EUR",
          TOTAL_ACTIVITY_VALUE_VAT_AMT: "10.00",
        },
      }),
      oss("amazon.fr", "FR", "20.00"),
    ];

    const lines = vatLinesOf(generate(rows), "FR");

    expect(lines.map((row) => row[HEADER.itemDesc])).toEqual(["VAT FR Regular", "VAT FR OSS"]);
    expect(lines.map((row) => row[HEADER.account])).toEqual(["VAT FR Regular", "VAT FR OSS"]);
  });

  it("counts Monaco as France, under either scheme", () => {
    const rows = [
      saleRow({ countryCode: "FR", transactionType: "Commande" }),
      vatRow({
        raw: {
          MARKETPLACE: "amazon.fr",
          TAX_REPORTING_SCHEME: "REGULAR",
          SALE_ARRIVAL_COUNTRY: "MC",
          TRANSACTION_CURRENCY_CODE: "EUR",
          TOTAL_ACTIVITY_VALUE_VAT_AMT: "9.97",
        },
      }),
      oss("amazon.fr", "MC", "4.98"),
      oss("amazon.fr", "FR", "1.00"),
    ];

    expect(
      vatLinesOf(generate(rows), "FR").map((row) => [row[HEADER.itemDesc], row[HEADER.itemPrice]]),
    ).toEqual([
      ["VAT FR Regular", "9.97"],
      ["VAT FR OSS", "5.98"],
    ]);
  });

  it("refuses the build when the invoice's own currency has no rate", () => {
    // A Swedish invoice priced in kronor with a blank Exchange Rate is not a
    // smaller error than a missing one: it is a wrong figure that reads as a
    // right one, and Zoho would take it. The Allegro invoice has always
    // refused on this, and so does this one.
    const rows = [
      saleRow({ countryCode: "SE", transactionType: "Order", currency: "SEK" }),
    ];

    expect(() => generate(rows)).toThrow(/No SEK rate as at 2026-06-30/);
  });

  it("refuses rather than drop VAT it cannot convert into the invoice's currency", () => {
    const rows = [
      saleRow({ countryCode: "PL", transactionType: "Zamówienie", currency: "PLN" }),
      vatRow({
        raw: {
          MARKETPLACE: "amazon.pl",
          TAX_REPORTING_SCHEME: "REGULAR",
          SALE_ARRIVAL_COUNTRY: "PL",
          // Stated in kronor on a złoty invoice — the one case that needs a
          // rate the invoice itself does not.
          TRANSACTION_CURRENCY_CODE: "SEK",
          TOTAL_ACTIVITY_VALUE_VAT_AMT: "5.00",
        },
      }),
    ];

    expect(() =>
      generateZohoInvoice(rows, {
        period: PERIOD,
        rules: RULES,
        // A rate for the invoice itself, none for the kronor inside it.
        company: GEYSER,
        fx: { PLN: { rate: "0.23", rateDate: PERIOD.end, source: "ecb" } },
      }),
    ).toThrow(/cannot be converted/);
  });

  it("prints no VAT line at all where there is no VAT", () => {
    const result = generate([saleRow()]);

    expect(vatLinesOf(result, "DE")).toHaveLength(0);
  });

  it("leaves out the schemes that are not invoiced here", () => {
    const rows = [
      saleRow(),
      vatRow({
        raw: {
          MARKETPLACE: "amazon.de",
          TAX_REPORTING_SCHEME: "UK_VOEC-IMPORT",
          SALE_ARRIVAL_COUNTRY: "GB",
          TRANSACTION_CURRENCY_CODE: "EUR",
          TOTAL_ACTIVITY_VALUE_VAT_AMT: "50",
        },
      }),
    ];

    expect(vatLinesOf(generate(rows), "DE")).toHaveLength(0);
  });

  it("converts a foreign currency at the invoice's own ECB rate, and says so", () => {
    const rows = [
      saleRow({ countryCode: "FR", transactionType: "Commande" }),
      // Sold on amazon.se in kronor, delivered to France: the French invoice
      // is in euro, and adding kronor to it unconverted would be wrong by an
      // order of magnitude.
      vatRow({
        currency: "SEK",
        raw: {
          MARKETPLACE: "amazon.se",
          TAX_REPORTING_SCHEME: "REGULAR",
          SALE_ARRIVAL_COUNTRY: "FR",
          TRANSACTION_CURRENCY_CODE: "SEK",
          TOTAL_ACTIVITY_VALUE_VAT_AMT: "100",
        },
      }),
    ];

    const result = generateZohoInvoice(rows, {
      period: PERIOD,
      rules: RULES,
      company: GEYSER,
      fx: { SEK: { rate: "0.0894", rateDate: PERIOD.end, source: "ecb" } },
    });

    expect(vatLinesOf(result, "FR").map((row) => row[HEADER.itemPrice])).toEqual(["8.94"]);
    expect(result.warnings.some((warning) => warning.includes("converted to EUR"))).toBe(true);
  });

  it("keeps VAT owed to a country with no invoice, on the invoice that sold it", () => {
    const rows = [
      saleRow({ countryCode: "DE" }),
      vatRow({
        raw: {
          MARKETPLACE: "amazon.de",
          TAX_REPORTING_SCHEME: "REGULAR",
          SALE_ARRIVAL_COUNTRY: "AT",
          TRANSACTION_CURRENCY_CODE: "EUR",
          TOTAL_ACTIVITY_VALUE_VAT_AMT: "87.36",
        },
      }),
    ];

    const result = generate(rows);

    expect(vatLinesOf(result, "DE").map((row) => [row[HEADER.itemDesc], row[HEADER.itemPrice]])).toEqual([
      ["VAT AT Regular", "87.36"],
    ]);
    expect(result.warnings.some((warning) => warning.includes("no invoice of its own"))).toBe(true);
  });
});
