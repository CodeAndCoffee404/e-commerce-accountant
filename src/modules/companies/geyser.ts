import { CHANNEL_RULES } from "@/modules/channels/registry";
import {
  IGNORED_SKUS,
  SELLER_VAT_NUMBERS,
  SKU_MAPPINGS,
  VAT_RATES,
} from "@/lib/reference/seed-data";

import type { CompanyRules } from "./types";

/**
 * Geyser — the client this application was built for, and the values every
 * company is currently computed from. `registry.ts` says why there is one set
 * and where the second one will attach.
 *
 * Every value here was a constant somewhere in `src/modules/reports`. Moving
 * them changes nothing about how they are edited: this is code, changed by a
 * pull request with a golden test to prove the numbers did not move. What it
 * changes is that a second company can hold different values without either
 * one becoming a setting somebody could flip by accident.
 *
 * `docs/RULES.md` explains why each of them is what it is; this file only says
 * what they are.
 */
export const GEYSER: CompanyRules = {
  registrations: SELLER_VAT_NUMBERS,
  shopify: {
    dataset: "shopify_geyser",
    // The shop ships from Spain, always. It decides the scheme Off-Amazon
    // Sales prints and which VAT account the invoice posts to — one fact, read
    // in two places, which is why it is one value.
    departureCountry: "ES",
    // Orders an employee wrote up in the admin, through the draft-order screen.
    handMadeSources: ["shopify_draft_order"],
    // The shop takes cards. An order marked paid this way was not paid at all.
    methodsThatAreNotPayments: ["manual"],
    countryAliases: { UK: "GB" },
    skippedArrivalCountries: ["CH"],
    recomputeZeroTaxCountries: ["GB"],
    zoho: {
      salesAccount: "Shopify Geyser Sales",
      customerName: "Geyser Website",
      invoicePrefix: "INV-GeyserWebsite-",
      ossBreakout: ["DE", "FR", "IT", "PL"],
      pooledVatAccount: "VAT OSS Other countries",
    },
  },

  amazon: {
    ossBreakout: ["ES", "IT", "FR", "PL", "CZ", "DE"],
    invoicePrefix: "INV-Amz ",
  },

  allegro: {
    // Allegro settles from Poland, so its REGULAR line is Poland's.
    homeCountry: "PL",
    salesAccount: "Allegro Sales",
    customerName: "Allegro",
    invoicePrefix: "INV-Allegro-",
  },

  seeds: {
    vatRates: VAT_RATES,
    skuMappings: SKU_MAPPINGS,
    ignoredSkus: IGNORED_SKUS,
    // Already the union of every channel module's own defaults, the Allegro
    // currency map among them.
    channelRules: CHANNEL_RULES,
  },
};
