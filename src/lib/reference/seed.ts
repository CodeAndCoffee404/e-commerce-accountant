import { getDb, schema } from "@/lib/db";

import {
  CHANNEL_RULES,
  IGNORED_SKUS,
  RULES_EFFECTIVE_FROM,
  SELLER_VAT_NUMBERS,
  SKU_MAPPINGS,
  VAT_RATES,
} from "./seed-data";

export type SeedResult = {
  vatRates: number;
  sellerVatNumbers: number;
  skuMappings: number;
  channelRules: number;
};

/**
 * Fills a tenant's reference data with the values the legacy scripts had built
 * in. Safe to run again: existing rows are left alone, so a rate the client has
 * since corrected is never quietly reverted to the legacy value.
 */
export async function seedReferenceData(tenantId: string): Promise<SeedResult> {
  const db = getDb();

  const [rates, sellers, skus, rules] = await Promise.all([
    db
      .insert(schema.vatRates)
      .values(
        VAT_RATES.map((rate) => ({
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
        SELLER_VAT_NUMBERS.map((entry) => ({
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
        ...SKU_MAPPINGS.map((mapping) => ({
          tenantId,
          channel: mapping.channel,
          sourceSku: mapping.sourceSku,
          targetSku: mapping.targetSku,
          itemName: mapping.itemName,
          isIgnored: false,
        })),
        ...IGNORED_SKUS.map((sku) => ({
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
        CHANNEL_RULES.map((rule) => ({
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
