import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildPeriod, collectPeriods } from "@/lib/ingest/period";
import { monthByNumber } from "@/lib/ingest/months";
import { generateOffAmazonSales, OFF_AMAZON_HEADERS } from "@/lib/reports/off-amazon";

import {
  corpusAvailable,
  ledgerForPeriod,
  readGolden,
  REPORTS,
  sameAmount,
  seededRules,
} from "./harness";

/** Every month legacy shipped an Off-Amazon report for. */
const PERIODS = [
  "2026.01 January",
  "2026.02 February",
  "2026.03 March",
  "2026.04 April",
  "2026.05 May",
  "2026.06 June",
  "2026.07 July",
];

function periodOf(label: string) {
  const [year, rest] = label.split(".");
  const month = monthByNumber(Number(rest.slice(0, 2)));

  if (!month) throw new Error(`не разобран период ${label}`);

  const built = buildPeriod(collectPeriods([{ year: Number(year), month }]));

  if (!built.ok) throw new Error(built.reason);

  return built.period;
}

/**
 * Rows are compared as multisets, not in file order.
 *
 * Matching on a partial key is not enough: two different orders can land on the
 * same day for the same amount, and pairing them by that alone hid a real
 * difference behind a coincidence. The canonical form covers every column, with
 * amounts normalised so `-4.98` and `-4.980` agree.
 */
function canonical(row: readonly string[]): string {
  return row
    .map((value) => {
      const text = String(value ?? "").trim();
      const asNumber = Number(text);

      return text !== "" && Number.isFinite(asNumber) ? asNumber.toFixed(4) : text;
    })
    .join("|");
}

/**
 * The one accepted difference: legacy wrote Cdiscount refunds positive in some
 * months and negative in others, because the script changed at some point and
 * the reports were never regenerated. The agreed rule is that a refund is
 * negative in every channel, so ours is the negative one.
 *
 * Recognised by flipping the sign back: if that turns our row into the legacy
 * row exactly, the sign is the whole of the difference. Anything else is a real
 * disagreement and fails. See docs/known-deviations.md §2.
 */
function isCdiscountRefundSign(ours: string, theirs: string): boolean {
  const columns = ours.split("|");

  if (columns[0] !== "Cdiscount" || columns[2] !== "REFUND") return false;

  // VAT, net and total — the three amounts.
  for (const index of [5, 6, 7]) {
    columns[index] = (-Number(columns[index])).toFixed(4);
  }

  return columns.join("|") === theirs;
}

describe.skipIf(!corpusAvailable)("Off-Amazon Sales против эталона", () => {
  it.each(PERIODS)("%s", async (label) => {
    const golden = await readGolden(
      path.join(REPORTS, `Off-Amazon Sales - ${label}`, `Off-Amazon Sales - ${label}.xlsx`),
    );

    expect(golden.headers).toEqual([...OFF_AMAZON_HEADERS]);

    const ledger = await ledgerForPeriod(label, ["allegro", "cdiscount", "shopify"]);
    const result = generateOffAmazonSales(ledger, {
      period: periodOf(label),
      rules: seededRules(),
      fx: {},
    });

    const ours = result.sheets[0].rows.map((row) => row.map((value) => String(value ?? "")));

    expect(ours.length).toBe(golden.rows.length);

    // Every row, as a multiset over all thirteen columns.
    const oursCanonical = ours.map(canonical).sort();
    const theirsCanonical = golden.rows.map(canonical).sort();

    const unmatched = oursCanonical.filter((row) => !theirsCanonical.includes(row));
    const theirsUnmatched = theirsCanonical.filter((row) => !oursCanonical.includes(row));

    // Each remaining difference has to be one we have written down. An
    // unexplained one fails, whatever its size.
    const unexplained = unmatched.filter(
      (row) => !theirsUnmatched.some((golden) => isCdiscountRefundSign(row, golden)),
    );

    expect(unexplained, `не объяснённые расхождения:\n${unexplained.join("\n")}`).toEqual([]);
    expect(unmatched.length).toBe(theirsUnmatched.length);

    // Totals agree once the recorded deviation is undone.
    const signed = (rows: string[][], column: number) =>
      rows.reduce((total, row) => {
        const value = Number(row[column] || 0);

        return total + (row[0] === "Cdiscount" && row[2] === "REFUND" ? Math.abs(value) : value);
      }, 0);

    expect(sameAmount(String(signed(ours, 7)), String(signed(golden.rows, 7)), "0.05")).toBe(true);
    expect(sameAmount(String(signed(ours, 5)), String(signed(golden.rows, 5)), "0.05")).toBe(true);
  }, 120_000);
});
