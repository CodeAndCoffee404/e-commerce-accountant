import { asc, count, desc, eq, max } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

export type ReferenceData = {
  vatRates: {
    id: string;
    country: string;
    rate: string;
    validFrom: string;
    validTo: string | null;
    note: string | null;
  }[];
  sellerVatNumbers: {
    id: string;
    country: string;
    vatNumber: string;
    validFrom: string;
    validTo: string | null;
    note: string | null;
  }[];
  skuMappings: {
    id: string;
    channel: string;
    sourceSku: string;
    sourceName: string;
    targetSku: string | null;
    itemName: string | null;
    isIgnored: boolean;
  }[];
  channelRules: {
    id: string;
    channel: string;
    key: string;
    value: unknown;
    note: string | null;
  }[];
  fx: {
    days: number;
    latest: string | null;
    currencies: string[];
  };
};

export async function loadReferenceData(tenantId: string): Promise<ReferenceData> {
  const db = getDb();

  const [vatRates, sellerVatNumbers, skuMappings, channelRules, fxSummary, fxCurrencies] =
    await Promise.all([
      db
        .select({
          id: schema.vatRates.id,
          country: schema.vatRates.country,
          rate: schema.vatRates.rate,
          validFrom: schema.vatRates.validFrom,
          validTo: schema.vatRates.validTo,
          note: schema.vatRates.note,
        })
        .from(schema.vatRates)
        .where(eq(schema.vatRates.tenantId, tenantId))
        .orderBy(asc(schema.vatRates.country), desc(schema.vatRates.validFrom)),

      db
        .select({
          id: schema.sellerVatNumbers.id,
          country: schema.sellerVatNumbers.country,
          vatNumber: schema.sellerVatNumbers.vatNumber,
          validFrom: schema.sellerVatNumbers.validFrom,
          validTo: schema.sellerVatNumbers.validTo,
          note: schema.sellerVatNumbers.note,
        })
        .from(schema.sellerVatNumbers)
        .where(eq(schema.sellerVatNumbers.tenantId, tenantId))
        .orderBy(asc(schema.sellerVatNumbers.country)),

      db
        .select({
          id: schema.skuMappings.id,
          channel: schema.skuMappings.channel,
          sourceSku: schema.skuMappings.sourceSku,
          sourceName: schema.skuMappings.sourceName,
          targetSku: schema.skuMappings.targetSku,
          itemName: schema.skuMappings.itemName,
          isIgnored: schema.skuMappings.isIgnored,
        })
        .from(schema.skuMappings)
        .where(eq(schema.skuMappings.tenantId, tenantId))
        .orderBy(asc(schema.skuMappings.isIgnored), asc(schema.skuMappings.sourceSku)),

      db
        .select({
          id: schema.channelRules.id,
          channel: schema.channelRules.channel,
          key: schema.channelRules.key,
          value: schema.channelRules.value,
          note: schema.channelRules.note,
        })
        .from(schema.channelRules)
        .where(eq(schema.channelRules.tenantId, tenantId))
        .orderBy(asc(schema.channelRules.channel), asc(schema.channelRules.key)),

      // The cache is shared across tenants: a published reference rate is the
      // same fact for everyone.
      db
        .select({ days: count(schema.fxRates.rateDate), latest: max(schema.fxRates.rateDate) })
        .from(schema.fxRates),

      db.selectDistinct({ quote: schema.fxRates.quote }).from(schema.fxRates),
    ]);

  return {
    vatRates,
    sellerVatNumbers,
    skuMappings,
    channelRules,
    fx: {
      days: fxSummary[0]?.days ?? 0,
      latest: fxSummary[0]?.latest ?? null,
      currencies: fxCurrencies.map((row) => row.quote).sort(),
    },
  };
}
