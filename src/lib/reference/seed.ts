import { getDb, schema } from "@/lib/db";

import { seedsFor } from "@/modules/companies/registry";

import { RULES_EFFECTIVE_FROM } from "./seed-data";

export type SeedResult = {
  vatRates: number;
  sellerVatNumbers: number;
  skuMappings: number;
  channelRules: number;
};

/**
 * Fills a company's reference tables with what it starts life holding.
 *
 * Taken from the company's own identifier rather than from a table of shared
 * values — `seedsFor` ignores it today and every company gets the same set, but
 * the call site is where a second company's answers will arrive, and a caller
 * that had to pass the values in would be a caller that could pass the wrong
 * ones.
 *
 * Safe to run again: existing rows are left alone, so a rate the client has
 * since corrected is never quietly reverted to the seeded value.
 */
export async function seedReferenceData(tenantId: string): Promise<SeedResult> {
  const db = getDb();
  const { vatRates, sellerVatNumbers, skuMappings, ignoredSkus, channelRules } = seedsFor(tenantId);

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
          scheme: entry.scheme,
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
