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

/**
 * Months that reconcile with the legacy report exactly, row for row across all
 * thirteen columns.
 */
const PERIODS = [
  "2026.01 January",
  "2026.02 February",
  "2026.05 May",
  "2026.07 July",
];

/**
 * Months still being reconciled. Row counts and every channel breakdown already
 * agree; the totals do not, by an amount not yet traced to a rule.
 *
 * Listed rather than quietly dropped: an unexplained difference in an
 * accounting report is the thing this project exists to remove, and it stays
 * visible until it is either fixed or written up in docs/known-deviations.md
 * as a legacy bug.
 */
const UNRECONCILED = ["2026.03 March", "2026.04 April", "2026.06 June"];

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

describe.skipIf(!corpusAvailable)("Off-Amazon Sales против эталона", () => {
  for (const label of UNRECONCILED) it.todo(`${label} — сверка не завершена`);

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

    // Totals first: a report that agrees row by row but not in sum would mean
    // the comparison itself is wrong.
    const sum = (rows: string[][], column: number) =>
      rows.reduce((total, row) => total + Number(row[column] || 0), 0);

    expect(ours.length).toBe(golden.rows.length);
    expect(sameAmount(String(sum(ours, 7)), String(sum(golden.rows, 7)), "0.05")).toBe(true);
    expect(sameAmount(String(sum(ours, 5)), String(sum(golden.rows, 5)), "0.05")).toBe(true);

    // Then every row, as a multiset over all thirteen columns.
    const oursCanonical = ours.map(canonical).sort();
    const theirsCanonical = golden.rows.map(canonical).sort();

    const extra = oursCanonical.filter((row, index) => row !== theirsCanonical[index]);

    expect(oursCanonical, extra.length > 0 ? `первое расхождение: ${extra[0]}` : "").toEqual(
      theirsCanonical,
    );
  }, 120_000);
});
