import { getDb, schema } from "@/lib/db";

import { companyProfile } from "@/modules/companies/registry";
import type { CompanyProfile } from "@/modules/companies/types";

import { RULES_EFFECTIVE_FROM } from "./seed-data";

export type SeedResult = {
  vatRates: number;
  sellerVatNumbers: number;
  skuMappings: number;
  channelRules: number;
};

/**
 * Fills a company's reference data with what its profile says it starts with.
 *
 * From the profile rather than from one shared table of values, and that is the
 * point of the profile existing: a new company seeded with Geyser's VAT
 * registrations would print somebody else's numbers on its first report and
 * nothing would notice.
 *
 * Safe to run again: existing rows are left alone, so a rate the client has
 * since corrected is never quietly reverted to the seeded value.
 */
export async function seedReferenceData(
  tenantId: string,
  profile: CompanyProfile = companyProfile("geyser"),
): Promise<SeedResult> {
  const db = getDb();
  const { vatRates, sellerVatNumbers, skuMappings, ignoredSkus, channelRules } = profile.seeds;

  const [rates, sellers, skus, rules] = await Promise.all([
    db
      .insert(schema.vatRates)
      .values(
        vatRates.map((rate) => ({
          tenantId,
          country: rate.country,
          rate: rate.rate,
          validFrom: RULES_EFFECTIVE_FROM,
          note: rate.note ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.vatRates.id }),

    db
      .insert(schema.sellerVatNumbers)
      .values(
        sellerVatNumbers.map((entry) => ({
          tenantId,
          country: entry.country,
          vatNumber: entry.vatNumber,
          validFrom: RULES_EFFECTIVE_FROM,
          note: entry.note ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.sellerVatNumbers.id }),

    db
      .insert(schema.skuMappings)
      .values([
        ...skuMappings.map((mapping) => ({
          tenantId,
          channel: mapping.channel,
          sourceSku: mapping.sourceSku,
          targetSku: mapping.targetSku,
          itemName: mapping.itemName,
          isIgnored: false,
        })),
        ...ignoredSkus.map((sku) => ({
          tenantId,
          channel: "amazon",
          sourceSku: sku,
          targetSku: null,
          itemName: null,
          isIgnored: true,
        })),
      ])
      .onConflictDoNothing()
      .returning({ id: schema.skuMappings.id }),

    db
      .insert(schema.channelRules)
      .values(
        channelRules.map((rule) => ({
          tenantId,
          channel: rule.channel,
          key: rule.key,
          value: rule.value,
          note: rule.note,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.channelRules.id }),
  ]);

  return {
    vatRates: rates.length,
    sellerVatNumbers: sellers.length,
    skuMappings: skus.length,
    channelRules: rules.length,
  };
}
