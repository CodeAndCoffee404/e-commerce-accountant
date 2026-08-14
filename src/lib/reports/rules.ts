import Decimal from "decimal.js";

import type { AllegroCurrencyRule, RulesSnapshot } from "./types";

/**
 * Reads one rule out of the snapshot. Returns null rather than throwing so a
 * generator can decide whether a missing rule is fatal or merely a row it has
 * to skip.
 */
export function channelRule<T>(
  rules: RulesSnapshot,
  channel: string,
  key: string,
): T | null {
  const found = rules.channelRules.find(
    (rule) => rule.channel === channel && rule.key === key,
  );

  return found ? (found.value as T) : null;
}

export function allegroCurrencyRule(
  rules: RulesSnapshot,
  currency: string,
): AllegroCurrencyRule | null {
  const map = channelRule<Record<string, AllegroCurrencyRule>>(
    rules,
    "allegro",
    "currency_map",
  );

  return map?.[currency] ?? null;
}

/**
 * The rate in force on a date, as a fraction: 20 % comes back as 0.2, which is
 * the form the reports are written in.
 *
 * Periods exist so that recalculating an old month uses the rate that applied
 * then. Where several rows overlap, the one that started latest wins.
 */
export function vatRateOn(
  rules: RulesSnapshot,
  country: string,
  on: string,
): Decimal | null {
  const candidates = rules.vatRates
    .filter(
      (rate) =>
        rate.country === country &&
        rate.validFrom <= on &&
        (rate.validTo === null || rate.validTo >= on),
    )
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom));

  if (candidates.length === 0) return null;

  return new Decimal(candidates[0].rate).dividedBy(100);
}

export type SkuDecision =
  | { kind: "ignore" }
  | { kind: "map"; targetSku: string; itemName: string }
  /** Unmapped SKUs still reach the invoice, with the raw code — legacy does the same. */
  | { kind: "passthrough" };

export function decideSku(rules: RulesSnapshot, channel: string, sku: string): SkuDecision {
  const mapping = rules.skuMappings.find(
    (entry) => entry.channel === channel && entry.sourceSku === sku,
  );

  if (!mapping) return { kind: "passthrough" };
  if (mapping.isIgnored) return { kind: "ignore" };

  return {
    kind: "map",
    targetSku: mapping.targetSku ?? sku,
    itemName: mapping.itemName ?? "",
  };
}

/**
 * Splits a gross amount into VAT and net.
 *
 * `VAT = gross × r / (1 + r)`, which is how the legacy reports are built, and
 * the arithmetic runs in decimal so a half-cent never lands on the wrong side
 * of a rounding boundary.
 */
export function splitGross(gross: Decimal, rate: Decimal): { vat: Decimal; net: Decimal } {
  const vat = gross.times(rate).dividedBy(rate.plus(1)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return { vat, net: gross.minus(vat) };
}
