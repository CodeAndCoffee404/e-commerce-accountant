import type { datasetId } from "@/lib/db/schema";

/**
 * The facts about one company that its reports are built from.
 *
 * These used to be constants inside the report modules, and being constants
 * was the right call: `docs/RULES.md` argues at length that the departure
 * country and what counts as a sale must not be editable in Settings, because
 * a switch there is one nobody reviews and it can silently put warranty
 * replacements into an invoice. A second company does not change that
 * argument — it only means there is more than one set of constants.
 *
 * So this is not a settings screen with a different name. A profile is code:
 * it is added and changed by a pull request, with a golden test to say the
 * numbers did not move. What stays in the database is what a month's close
 * legitimately changes — VAT registrations, rates, SKU mappings, channel rules
 * — and `seeds` below is only what a brand new company starts with.
 */

export type ShopifyProfile = {
  /** Which Shopify dataset is this company's shop. */
  dataset: (typeof datasetId.enumValues)[number];
  /** Where the goods leave from. Decides the tax regime and the domestic VAT account. */
  departureCountry: string;
  /** Order sources that mean a person typed the order in by hand. */
  handMadeSources: readonly string[];
  /** Payment methods this shop cannot actually have taken money by. */
  methodsThatAreNotPayments: readonly string[];
  /** Country codes the export writes differently from the reports. */
  countryAliases: Readonly<Record<string, string>>;
  /** Countries left out of the reports by agreement, silently. */
  skippedArrivalCountries: readonly string[];
  /** Countries whose reported zero tax is known to be wrong and is recomputed. */
  recomputeZeroTaxCountries: readonly string[];
  zoho: {
    /** The account goods post to, spelled exactly as Zoho has it. */
    salesAccount: string;
    customerName: string;
    /** Before the month: `INV-GeyserWebsite-` gives `INV-GeyserWebsite-07.26`. */
    invoicePrefix: string;
    /** Markets that get a VAT line of their own; everywhere else is pooled. */
    ossBreakout: readonly string[];
    pooledVatAccount: string;
  };
};

export type AmazonProfile = {
  /** Markets that get a VAT line of their own under one-stop-shop. */
  ossBreakout: readonly string[];
  invoicePrefix: string;
};

export type AllegroProfile = {
  /** Where Allegro sales are settled from: decides the REGULAR VAT account. */
  homeCountry: string;
  salesAccount: string;
  customerName: string;
  invoicePrefix: string;
};

/** What a company's reference tables are filled with on the day it is created. */
export type CompanySeeds = {
  vatRates: readonly { country: string; rate: string; note?: string }[];
  sellerVatNumbers: readonly {
    country: string;
    /** `REGULAR` or `UNION-OSS`. With the country, this is what a report looks up. */
    scheme: string;
    vatNumber: string;
    note?: string;
  }[];
  skuMappings: readonly {
    channel: string;
    sourceSku: string;
    targetSku: string;
    itemName: string;
  }[];
  ignoredSkus: readonly string[];
  channelRules: readonly { channel: string; key: string; value: unknown; note?: string }[];
};

export type CompanyProfile = {
  /** Stored on the company row; the only thing the database knows about this. */
  key: string;
  shopify?: ShopifyProfile;
  amazon?: AmazonProfile;
  allegro?: AllegroProfile;
  seeds: CompanySeeds;
};
