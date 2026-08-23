import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import type { LedgerRow } from "@/lib/reports/types";
import type { Period } from "@/lib/ingest/period";

import { generateZohoInvoice, invoiceNumber, ZOHO_HEADERS } from "./amazon-zoho-invoice";

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

function generate(rows: LedgerRow[]) {
  return generateZohoInvoice(rows, { period: PERIOD, rules: RULES, fx: {} });
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

describe("VAT lines on the Amazon invoice for Zoho", () => {
  it("adds a VAT Regular and VAT OSS line for the marketplace, summed and priced from the VAT report", () => {
    const rows = [
      saleRow(),
      vatRow({ raw: { MARKETPLACE: "amazon.de", TAX_REPORTING_SCHEME: "REGULAR", TOTAL_ACTIVITY_VALUE_VAT_AMT: "1.90" } }),
      vatRow({ raw: { MARKETPLACE: "amazon.de", TAX_REPORTING_SCHEME: "REGULAR", TOTAL_ACTIVITY_VALUE_VAT_AMT: "0.10" } }),
      vatRow({ raw: { MARKETPLACE: "amazon.de", TAX_REPORTING_SCHEME: "UNION-OSS", TOTAL_ACTIVITY_VALUE_VAT_AMT: "3.33" } }),
      // A different marketplace and a non-matching scheme must not leak in.
      vatRow({ raw: { MARKETPLACE: "amazon.fr", TAX_REPORTING_SCHEME: "REGULAR", TOTAL_ACTIVITY_VALUE_VAT_AMT: "99" } }),
      vatRow({ raw: { MARKETPLACE: "amazon.de", TAX_REPORTING_SCHEME: "UK_VOEC-IMPORT", TOTAL_ACTIVITY_VALUE_VAT_AMT: "50" } }),
    ];

    const result = generate(rows);
    const number = invoiceNumber("DE", PERIOD.end);
    const vatLines = result.sheets[0].rows.filter(
      (row) => row[HEADER.invoiceNumber] === number && row[HEADER.account] !== "Amazon Sales DE",
    );

    expect(vatLines).toHaveLength(2);

    const regular = vatLines.find((row) => row[HEADER.itemDesc] === "VAT Regular")!;
    const oss = vatLines.find((row) => row[HEADER.itemDesc] === "VAT OSS")!;

    expect(regular[HEADER.itemPrice]).toBe("2.00");
    expect(regular[HEADER.account]).toBe("VAT DE Regular");
    expect(regular[HEADER.quantity]).toBe("1");

    expect(oss[HEADER.itemPrice]).toBe("3.33");
    expect(oss[HEADER.account]).toBe("VAT DE OSS");

    // Duplicated verbatim from the invoice they belong to.
    const invoiceLine = result.sheets[0].rows.find((row) => row[HEADER.account] === "Amazon Sales DE")!;

    for (const field of [HEADER.invoiceDate, HEADER.customerName, HEADER.currency, HEADER.rate] as const) {
      expect(regular[field]).toBe(invoiceLine[field]);
      expect(oss[field]).toBe(invoiceLine[field]);
    }
  });

  it("still writes both VAT lines, priced at zero, when the VAT report has nothing for that marketplace", () => {
    const result = generate([saleRow()]);
    const number = invoiceNumber("DE", PERIOD.end);

    const vatLines = result.sheets[0].rows.filter(
      (row) => row[HEADER.invoiceNumber] === number && row[HEADER.account] !== "Amazon Sales DE",
    );

    expect(vatLines.map((row) => row[HEADER.itemDesc])).toEqual(["VAT Regular", "VAT OSS"]);
    expect(vatLines.every((row) => row[HEADER.itemPrice] === "0.00")).toBe(true);
  });

  it("gives every invoiced marketplace exactly two VAT lines", () => {
    const result = generate([
      saleRow({ countryCode: "DE" }),
      saleRow({ countryCode: "FR", transactionType: "Commande", sku: "SKU-2" }),
    ]);

    const byInvoice = new Map<string, number>();

    for (const row of result.sheets[0].rows) {
      if (row[HEADER.account] === "Amazon Sales DE" || row[HEADER.account] === "Amazon Sales FR") continue;

      const key = String(row[HEADER.invoiceNumber]);

      byInvoice.set(key, (byInvoice.get(key) ?? 0) + 1);
    }

    expect([...byInvoice.values()]).toEqual([2, 2]);
  });
});
