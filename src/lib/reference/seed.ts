import { getDb, schema } from "@/lib/db";

import { eq } from "drizzle-orm";

import { companyProfile } from "@/modules/companies/registry";
import type { CompanyProfile } from "@/modules/companies/types";

import { RULES_EFFECTIVE_FROM } from "./seed-data";

/**
 * The profile a company was created with.
 *
 * There is no sensible default: seeding a company from the wrong profile puts
 * another company's VAT registrations in its tables, and it would print them
 * on its first report with nothing to notice. So the profile is looked up, and
 * a company whose key names none refuses rather than falling back.
 */
export async function profileOf(tenantId: string): Promise<CompanyProfile> {
  const [row] = await getDb()
    .select({ profileKey: schema.tenants.profileKey })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);

  if (!row) throw new Error("This company no longer exists.");

  return companyProfile(row.profileKey);
}

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
  profile: CompanyProfile,
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
