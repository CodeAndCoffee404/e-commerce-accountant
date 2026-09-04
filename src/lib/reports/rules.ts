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
  | { kind: "passthrough" }
  /**
   * The code is mapped, but to something else: the rows filed under it expect
   * a different item name than the one the source just sent. Never invoiced —
   * a mapping that no longer describes what arrived is not a mapping.
   */
  | { kind: "mismatch"; expectedNames: string[] }
  /**
   * A row was found and it does not say what to bill: no invoice code, or no
   * item name. Never invoiced either — falling back to the channel's own code
   * puts a raw Shopify string where the client's catalogue should be, and an
   * empty item name is a line Zoho cannot match to anything.
   */
  | { kind: "incomplete" };

/**
 * Names are compared as a person would read them: case and spacing are not
 * what makes two items different.
 */
export function normaliseItemName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * What to bill a source code as.
 *
 * Pass `sourceName` and the mapping is checked as well as read: the row has
 * to agree about what that code is, or the build stops and asks. That is for
 * channels whose export carries an item name next to the code — Shopify,
 * where the code is optional, products get renamed and one code has been seen
 * covering two different products. Leave it out and only the code is matched,
 * which is what every other channel means by a mapping.
 */
export function decideSku(
  rules: RulesSnapshot,
  channel: string,
  sku: string,
  sourceName?: string,
): SkuDecision {
  const candidates = rules.skuMappings.filter(
    (entry) => entry.channel === channel && entry.sourceSku === sku,
  );

  if (candidates.length === 0) return { kind: "passthrough" };

  const mapping =
    sourceName === undefined
      ? candidates[0]
      : candidates.find(
          (entry) =>
            entry.sourceName !== "" &&
            normaliseItemName(entry.sourceName) === normaliseItemName(sourceName),
        );

  // Rows exist for the code and none of them claims this name. An empty
  // expected name is a row nobody has finished filling in, and it is reported
  // rather than trusted: that is the whole point of asking for the name.
  if (!mapping) return { kind: "mismatch", expectedNames: candidates.map((e) => e.sourceName) };

  if (mapping.isIgnored) return { kind: "ignore" };

  // Only where the mapping is being checked — the channels that send a name to
  // check it against. Elsewhere a half-filled row still falls back to the raw
  // code, exactly as it always has.
  if (sourceName !== undefined && (!mapping.targetSku || !mapping.itemName)) {
    return { kind: "incomplete" };
  }

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
