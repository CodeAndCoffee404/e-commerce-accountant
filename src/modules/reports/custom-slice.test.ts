import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import type { LedgerRow } from "@/lib/reports/types";
import type { Period } from "@/lib/ingest/period";

import {
  customReportKey,
  customSliceConfigSchema,
  describeConfig,
  type CustomSliceConfig,
} from "./custom-slice-config";
import { customSliceModule, generateCustomSlice } from "./custom-slice";

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: "row",
    dataset: "shopify",
    channel: "shopify",
    countryCode: "ES",
    occurredOn: "2026-07-15",
    transactionType: "sale",
    currency: "EUR",
    gross: new Decimal("10"),
    vatAmount: new Decimal("2"),
    netAmount: new Decimal("8"),
    sku: "SKU-1",
    quantity: new Decimal(1),
    sourceFileId: "file",
    sourceRowNumber: 1,
    raw: {},
    ...overrides,
  };
}

function config(overrides: Partial<CustomSliceConfig> = {}): CustomSliceConfig {
  return customSliceConfigSchema.parse({
    name: "Test slice",
    groupBy: ["countryCode"],
    measures: ["rows", "gross"],
    ...overrides,
  });
}

const PERIOD: Period = {
  label: "2026.07 July",
  granularity: "month",
  start: "2026-07-01",
  end: "2026-07-31",
};

describe("custom slice generator", () => {
  it("groups and sums in decimal, not float", () => {
    const rows = [
      row({ countryCode: "PL", gross: new Decimal("0.1") }),
      row({ countryCode: "PL", gross: new Decimal("0.2") }),
      row({ countryCode: "DE", gross: new Decimal("5") }),
    ];

    const result = generateCustomSlice(rows, config());
    const sheet = result.sheets[0];

    // Sorted by group, totals underneath. 0.1 + 0.2 is exactly 0.3 here — the
    // binary-addition artefact this system exists to avoid.
    expect(sheet.headers).toEqual(["Country", "Rows", "Gross"]);
    expect(sheet.rows).toEqual([
      ["DE", 1, "5"],
      ["PL", 2, "0.3"],
      ["Total", 3, "5.3"],
    ]);
  });

  it("filters case-insensitively and reports what fell out", () => {
    const rows = [
      row({ countryCode: "PL" }),
      row({ countryCode: "PL " }),
      row({ countryCode: "DE" }),
    ];

    const result = generateCustomSlice(
      rows,
      config({
        filters: {
          datasets: [],
          countries: ["pl"],
          currencies: [],
          transactionTypes: [],
          skus: [],
        },
      }),
    );

    expect(result.sheets[0].rows).toEqual([
      ["PL", 2, "20"],
      ["Total", 2, "20"],
    ]);
    expect(result.skipped).toEqual([
      { reason: "Did not match the definition's filters", count: 1 },
    ]);
  });

  it("never sums an unreadable amount as zero — it counts it and says so", () => {
    const rows = [row({ gross: new Decimal("7") }), row({ gross: null })];

    const result = generateCustomSlice(rows, config());

    expect(result.sheets[0].rows).toEqual([
      ["ES", 2, "7"],
      ["Total", 2, "7"],
    ]);
    expect(result.warnings).toEqual([
      "Gross: 1 row carries no readable value — counted in Rows, left out of this sum.",
    ]);
  });

  it("groups a blank value under its own bucket rather than dropping the row", () => {
    const rows = [row({ countryCode: null }), row({ countryCode: "PL" })];

    const result = generateCustomSlice(rows, config({ measures: ["rows"] }));

    expect(result.sheets[0].rows).toContainEqual(["—", 1]);
    expect(result.sheets[0].rows).toContainEqual(["PL", 1]);
  });

  it("says out loud when nothing matched", () => {
    const result = generateCustomSlice([], config());

    expect(result.sheets[0].rows).toEqual([["Total", 0, "0"]]);
    expect(result.warnings[0]).toContain("No rows matched");
  });

  it("a filter on a null field excludes the row", () => {
    const rows = [row({ sku: null }), row({ sku: "SKU-1" })];

    const result = generateCustomSlice(
      rows,
      config({
        groupBy: ["sku"],
        measures: ["rows"],
        filters: { datasets: [], countries: [], currencies: [], transactionTypes: [], skus: ["SKU-1"] },
      }),
    );

    expect(result.sheets[0].rows).toEqual([
      ["SKU-1", 1],
      ["Total", 1],
    ]);
  });
});

describe("custom slice module", () => {
  const context = { period: PERIOD, rules: { vatRates: [], sellerVatNumbers: [], skuMappings: [], channelRules: [] }, fx: {} };

  it("reads every channel, so a channel added later joins automatically", () => {
    expect(customSliceModule.definition.datasets).toContain("shopify");
    expect(customSliceModule.definition.datasets).toContain("amazon_vat");
    expect(customSliceModule.definition.datasets.length).toBeGreaterThanOrEqual(5);
    expect(customSliceModule.definition.requiresEveryDataset).toBe(false);
    expect(customSliceModule.definition.informational).toBe(true);
  });

  it("refuses to build without a definition", () => {
    expect(() => customSliceModule.generate([row()], context)).toThrow("none was named");
  });

  it("names the definition and the fix when the stored value is malformed", () => {
    expect(() =>
      customSliceModule.generate([row()], { ...context, variant: { key: "broken", value: { name: "X" } } }),
    ).toThrow(/"broken"[\s\S]*Settings/);
  });

  it("builds from a stored definition", () => {
    const result = customSliceModule.generate([row()], {
      ...context,
      variant: { key: "by-country", value: config() },
    });

    expect(result.sheets[0].name).toBe("Test slice");
    expect(result.sheets[0].rows).toEqual([
      ["ES", 1, "10"],
      ["Total", 1, "10"],
    ]);
  });

  it("summarises a stored definition for its card", () => {
    const summary = customSliceModule.definition.variants!.summarise(config());

    expect(summary).toBe("Groups by Country; shows Rows, Gross; counts every current row of the period.");
    expect(customSliceModule.definition.variants!.summarise({ garbage: true })).toContain("malformed");
  });
});

describe("custom slice definition schema", () => {
  it("refuses names a filename or a sheet cannot carry", () => {
    expect(
      customSliceConfigSchema.safeParse({ name: "a/b", groupBy: ["sku"], measures: ["rows"] })
        .success,
    ).toBe(false);
    expect(() => config({ name: "Sales: July" })).toThrow();
  });

  it("refuses duplicates and empty selections", () => {
    expect(
      customSliceConfigSchema.safeParse({
        name: "X",
        groupBy: ["sku", "sku"],
        measures: ["rows"],
      }).success,
    ).toBe(false);
    expect(
      customSliceConfigSchema.safeParse({ name: "X", groupBy: [], measures: ["rows"] }).success,
    ).toBe(false);
    expect(
      customSliceConfigSchema.safeParse({ name: "X", groupBy: ["sku"], measures: [] }).success,
    ).toBe(false);
  });

  it("fills absent filters so an old definition keeps parsing", () => {
    const parsed = customSliceConfigSchema.parse({
      name: "X",
      groupBy: ["dataset"],
      measures: ["rows"],
    });

    expect(parsed.filters.countries).toEqual([]);
  });

  it("derives a stable, readable key from a name", () => {
    expect(customReportKey("Sales by country")).toBe("sales-by-country");
    expect(customReportKey("Продажи по странам")).toBe("продажи-по-странам");
    expect(customReportKey("///")).toBe("report");
  });

  it("describes filters in the summary", () => {
    const summary = describeConfig(
      config({
        filters: {
          datasets: ["shopify"],
          countries: ["PL", "DE"],
          currencies: [],
          transactionTypes: [],
          skus: [],
        },
      }),
      { shopify: "Shopify" },
    );

    expect(summary).toBe(
      "Groups by Country; shows Rows, Gross; counts rows where channel Shopify; country PL, DE.",
    );
  });
});
