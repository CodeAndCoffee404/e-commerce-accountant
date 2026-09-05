import { describe, expect, it } from "vitest";

import { reportDefinition } from "./definitions";
import {
  defaultSettings,
  describeNeeds,
  normaliseSettings,
  requiredCountries,
  requiredDatasets,
} from "./settings";
import { ZOHO_COUNTRIES } from "@/modules/reports/amazon-zoho-invoice";

describe("report settings", () => {
  const offAmazon = reportDefinition("off_amazon_sales");
  const zoho = reportDefinition("amazon_zoho_invoice");

  it("defaults to exactly the behaviour before settings existed", () => {
    const settings = defaultSettings();

    expect(settings.off_amazon_sales.enabled).toBe(true);
    expect(requiredDatasets(offAmazon, settings.off_amazon_sales)).toEqual([
      "allegro",
      "cdiscount",
      "shopify_geyser",
    ]);
    expect(requiredCountries(settings.amazon_zoho_invoice)).toEqual([...ZOHO_COUNTRIES]);
    expect(requiredDatasets(zoho, settings.amazon_zoho_invoice)).toEqual([
      "amazon_monthly",
      "amazon_vat",
    ]);
    expect(describeNeeds(offAmazon, settings.off_amazon_sales)).toBe(offAmazon.needs);
  });

  it("treats a half-written or foreign value as the strict default", () => {
    // Anything unrecognised falls back to required — a corrupted row must
    // tighten the checks, never loosen them.
    for (const raw of [null, 42, "off", { datasets: { allegro: "sometimes" } }]) {
      const settings = normaliseSettings(offAmazon, raw);

      expect(settings.enabled).toBe(true);
      expect(requiredDatasets(offAmazon, settings)).toHaveLength(3);
    }
  });

  it("lets a channel go optional without leaving the report", () => {
    const settings = normaliseSettings(offAmazon, {
      enabled: true,
      datasets: { cdiscount: "optional" },
    });

    expect(requiredDatasets(offAmazon, settings)).toEqual(["allegro", "shopify_geyser"]);
    // The needs text follows the configuration, so the card can never promise
    // one thing while the build demands another.
    expect(describeNeeds(offAmazon, settings)).toContain("Allegro and Shopify EU");
    expect(describeNeeds(offAmazon, settings)).toContain("Optional and included when present: Cdiscount");
  });

  it("drops a retired marketplace from the Zoho requirement", () => {
    const settings = normaliseSettings(zoho, {
      enabled: true,
      countries: { UK: "optional" },
    });

    expect(requiredCountries(settings)).toEqual(
      ZOHO_COUNTRIES.filter((country) => country !== "UK"),
    );
    expect(describeNeeds(zoho, settings)).toContain("Optional and invoiced when present: UK");
    // The VAT report is still demanded, so the card has to keep saying so.
    expect(describeNeeds(zoho, settings)).toContain("Amazon VAT transaction report");
  });

  it("says when the VAT report has been made optional", () => {
    const settings = normaliseSettings(zoho, {
      enabled: true,
      datasets: { amazon_vat: "optional" },
    });

    expect(requiredDatasets(zoho, settings)).toEqual(["amazon_monthly"]);
    expect(describeNeeds(zoho, settings)).toContain(
      "The Amazon VAT transaction report is optional",
    );
  });

  it("only the invoice carries country settings", () => {
    const settings = normaliseSettings(offAmazon, { countries: { UK: "optional" } });

    expect(Object.keys(settings.countries)).toHaveLength(0);
  });

  it("reads enabled: false and nothing subtler", () => {
    expect(normaliseSettings(offAmazon, { enabled: false }).enabled).toBe(false);
    expect(normaliseSettings(offAmazon, { enabled: "no" }).enabled).toBe(true);
  });
});
