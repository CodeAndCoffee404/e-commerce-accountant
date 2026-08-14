import { describe, expect, it } from "vitest";

import { REPORT_DEFINITIONS, reportDefinition } from "./definitions";

describe("report definitions", () => {
  it("refuses a partial Off-Amazon Sales", () => {
    const definition = reportDefinition("off_amazon_sales");

    // The whole point: built from whichever channels happen to be uploaded, the
    // sheet looks complete and under-reports by the rest.
    expect(definition.requiresEveryDataset).toBe(true);
    expect([...definition.datasets].sort()).toEqual(["allegro", "cdiscount", "shopify"]);
  });

  it("does not demand every dataset where one file covers everything", () => {
    // The VAT report is a single file spanning every marketplace, and the Zoho
    // invoice checks its ten countries separately.
    expect(reportDefinition("sales_by_currency").requiresEveryDataset).toBe(false);
    expect(reportDefinition("amazon_zoho_invoice").requiresEveryDataset).toBe(false);
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
