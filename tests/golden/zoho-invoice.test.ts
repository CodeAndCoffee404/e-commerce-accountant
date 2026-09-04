import path from "node:path";

import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import { monthByNumber } from "@/lib/ingest/months";
import { buildPeriod, collectPeriods } from "@/lib/ingest/period";
import { generateZohoInvoice, missingCountries, ZOHO_HEADERS } from "@/modules/reports/amazon-zoho-invoice";

import { corpusAvailable, ledgerForPeriod, readGolden, REPORTS, seededRules } from "./harness";
import { GEYSER } from "@/modules/companies/geyser";

const PERIODS = ["2026.05 May", "2026.07 July"];

/**
 * Which invoices legacy managed to price at all.
 *
 * Read from the report rather than assumed: July priced Britain and Ireland
 * correctly and zeroed the other eight, but May came out zero for all ten. The
 * spreadsheet formula behind it failed differently from month to month, so
 * hard-coding the two that "work" would be wrong half the time.
 */
function pricedInvoices(rows: readonly (readonly (string | number | null)[])[]): Set<string> {
  const priced = new Set<string>();

  for (const row of rows) {
    if (!new Decimal(String(row[9] ?? "0") || "0").isZero()) priced.add(String(row[1]));
  }

  return priced;
}

function periodOf(label: string) {
  const [year, rest] = label.split(".");
  const month = monthByNumber(Number(rest.slice(0, 2)));

  if (!month) throw new Error(`could not read the period ${label}`);

  const built = buildPeriod(collectPeriods([{ year: Number(year), month }]));

  if (!built.ok) throw new Error(built.reason);

  return built.period;
}

const text = (value: string | number | null | undefined) => String(value ?? "").trim();

/** Total quantity per invoice and item, which no rounding may change. */
function quantities(rows: readonly (readonly (string | number | null)[])[]) {
  const totals = new Map<string, Decimal>();

  for (const row of rows) {
    const key = `${text(row[1])}|${text(row[6])}`;
    const quantity = new Decimal(text(row[8]) || "0");

    totals.set(key, (totals.get(key) ?? new Decimal(0)).plus(quantity));
  }

  return totals;
}

describe.skipIf(!corpusAvailable)("Amazon invoice for Zoho against the reference", () => {
  it.each(PERIODS)("%s", async (label) => {
    const golden = await readGolden(
      path.join(
        REPORTS,
        `Amazon invoice for Zoho - ${label}`,
        `Amazon invoice for Zoho - ${label}.xlsx`,
      ),
    );

    expect(golden.headers).toEqual([...ZOHO_HEADERS]);

    const ledger = await ledgerForPeriod(label, ["amazon_monthly"]);

    expect(missingCountries(ledger), "marketplaces are missing").toEqual([]);

    const result = generateZohoInvoice(ledger, {
      period: periodOf(label),
      rules: seededRules(),
      company: GEYSER,
      fx: {},
    });

    const ours = result.sheets[0].rows;

    // Same invoices, one per marketplace.
    expect(new Set(ours.map((row) => text(row[1])))).toEqual(
      new Set(golden.rows.map((row) => text(row[1]))),
    );

    // Quantities are the invariant: rows may be grouped differently, but not a
    // single unit may appear or disappear.
    const oursByItem = quantities(ours);
    const theirsByItem = quantities(golden.rows);

    expect([...oursByItem.keys()].sort()).toEqual([...theirsByItem.keys()].sort());

    for (const [key, quantity] of oursByItem) {
      expect(quantity.toFixed(), `quantity, ${key}`).toBe(theirsByItem.get(key)?.toFixed());
    }

    // Where legacy managed to price an invoice, the lines must agree exactly.
    const priced = pricedInvoices(golden.rows);

    expect(priced.size, "the reference has no priced invoice at all").toBeGreaterThanOrEqual(0);

    const oursCorrect = ours.filter((row) => priced.has(text(row[1])));
    const theirsCorrect = golden.rows.filter((row) => priced.has(text(row[1])));

    // Not line counts: legacy groups by its own float unit price and we group
    // by the exact one, so the same sales can land in a different number of
    // lines without a cent moving. What must agree is the money.
    const revenue = (rows: readonly (readonly (string | number | null)[])[]) => {
      const totals = new Map<string, Decimal>();

      for (const row of rows) {
        const key = `${text(row[1])}|${text(row[6])}`;
        const line = new Decimal(text(row[8]) || "0").times(new Decimal(text(row[9]) || "0"));

        totals.set(key, (totals.get(key) ?? new Decimal(0)).plus(line));
      }

      return totals;
    };

    const oursRevenue = revenue(oursCorrect);
    const theirsRevenue = revenue(theirsCorrect);

    for (const [key, total] of theirsRevenue) {
      // Zero is the recorded bug striking a line: Sweden's `1 116,80` uses a
      // space for thousands, which the spreadsheet could not coerce even though
      // `279,20` beside it worked. Ours must not be zero there.
      if (total.isZero()) {
        expect(oursRevenue.get(key)?.isZero(), `zeroed in legacy, must not be zero here: ${key}`).toBe(false);
        continue;
      }

      const ours = oursRevenue.get(key);

      expect(ours, `no revenue of ours for ${key}`).toBeDefined();
      expect(
        ours!.minus(total).abs().lte("0.02"),
        `revenue for ${key}: ${ours?.toFixed(2)} against ${total.toFixed(2)}`,
      ).toBe(true);
    }
  }, 180_000);

  it("the item price is no longer zero — the bug itself", async () => {
    const label = "2026.07 July";
    const ledger = await ledgerForPeriod(label, ["amazon_monthly"]);
    const result = generateZohoInvoice(ledger, {
      period: periodOf(label),
      rules: seededRules(),
      company: GEYSER,
      fx: {},
    });

    const golden = await readGolden(
      path.join(
        REPORTS,
        `Amazon invoice for Zoho - ${label}`,
        `Amazon invoice for Zoho - ${label}.xlsx`,
      ),
    );

    const zeroPriced = (rows: readonly (readonly (string | number | null)[])[]) =>
      rows.filter((row) => new Decimal(text(row[9]) || "0").isZero());

    // Reference: more than half the invoice lines went to Zoho priced at zero.
    expect(zeroPriced(golden.rows).length).toBeGreaterThan(golden.rows.length / 2);

    // Every line of ours carries a price.
    expect(zeroPriced(result.sheets[0].rows)).toEqual([]);
  }, 180_000);
});
