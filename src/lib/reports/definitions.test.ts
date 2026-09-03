import { describe, expect, it } from "vitest";

import { REPORT_DEFINITIONS, reportDefinition } from "./definitions";

describe("report definitions", () => {
  it("refuses a partial Off-Amazon Sales", () => {
    const definition = reportDefinition("off_amazon_sales");

    // The whole point: built from whichever channels happen to be uploaded, the
    // sheet looks complete and under-reports by the rest.
    expect(definition.requiresEveryDataset).toBe(true);
    expect([...definition.datasets].sort()).toEqual(["allegro", "cdiscount", "shopify_geyser"]);
  });

  it("does not demand every dataset where one file covers everything", () => {
    // The VAT report is a single file spanning every marketplace, and it is
    // all this one reads.
    expect(reportDefinition("sales_by_currency").requiresEveryDataset).toBe(false);
  });

  it("refuses the Zoho invoice without the VAT transaction report", () => {
    const definition = reportDefinition("amazon_zoho_invoice");

    // The tax on these sales is stated in the VAT report. An invoice issued
    // for a month whose VAT report has not arrived is issued before its own
    // VAT is known, so the month is not offered at all.
    expect([...definition.datasets].sort()).toEqual(["amazon_monthly", "amazon_vat"]);
    expect(definition.requiresEveryDataset).toBe(true);
    expect(definition.needs).toContain("VAT");
  });

  it("allows a quarter only where legacy allowed one", () => {
    expect(reportDefinition("sales_by_currency").granularity).toContain("quarter");
    // An invoice is dated the last day of a month and numbered by month, so a
    // quarter has no meaning for it.
    expect(reportDefinition("amazon_zoho_invoice").granularity).not.toContain("quarter");
    expect(reportDefinition("off_amazon_sales").granularity).not.toContain("quarter");
  });

  it("names every report and every dataset it reads", () => {
    for (const definition of REPORT_DEFINITIONS) {
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.datasets.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });

  it("throws on a report type it does not know", () => {
    // @ts-expect-error deliberately outside the union
    expect(() => reportDefinition("invented")).toThrow("Unknown report type");
  });
});
