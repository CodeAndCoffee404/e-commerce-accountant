import Decimal from "decimal.js";

import { parseDecimalValue } from "@/lib/ingest/numbers";

import type { GeneratorResult, LedgerRow, ReportContext, ReportSheet } from "@/lib/reports/types";

import type { ReportModule } from "./types";

/** The column the totals row sums, and the one legacy puts its total under. */
export const TOTAL_COLUMN = "TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL";

/**
 * Sales report by currency: the Amazon VAT report split into one sheet per
 * settlement currency, rows unchanged, with a total underneath.
 *
 * Rows are passed through exactly as the file had them. This report is read
 * against Amazon's own figures, so reformatting a column — even into a better
 * form — would make the two impossible to compare by eye.
 */
export function generateSalesByCurrency(
  rows: readonly LedgerRow[],
  context: ReportContext,
  sourceHeaders: readonly string[],
): GeneratorResult {
  const byCurrency = new Map<string, LedgerRow[]>();
  const skipped: { reason: string; count: number }[] = [];
  let withoutCurrency = 0;

  for (const row of rows) {
    if (row.dataset !== "amazon_vat") continue;

    const currency = row.currency?.trim();

    if (!currency) {
      withoutCurrency += 1;
      continue;
    }

    const bucket = byCurrency.get(currency);

    if (bucket) bucket.push(row);
    else byCurrency.set(currency, [row]);
  }

  if (withoutCurrency > 0) {
    skipped.push({ reason: "Amazon VAT: row without a currency", count: withoutCurrency });
  }

  const totalIndex = sourceHeaders.indexOf(TOTAL_COLUMN);
  const headers = [...sourceHeaders];
  const warnings: string[] = [];

  const sheets: ReportSheet[] = [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, currencyRows]) => {
      const body = currencyRows.map((row) => headers.map((header) => row.raw[header] ?? ""));

      if (totalIndex !== -1) {
        let total = new Decimal(0);

        for (const row of currencyRows) {
          // Through the shared parser, not `new Decimal(...)`: an amount with a
          // space for thousands or a Unicode minus would throw and take the
          // whole report down with it.
          const value = parseDecimalValue(row.raw[TOTAL_COLUMN], {
            decimalSeparator: ".",
            column: TOTAL_COLUMN,
          });

          if (value) total = total.plus(value);
        }

        // Decimal, not a running float. The legacy total for July reads
        // 913.8299999999998 — the same sum, carrying the error of binary
        // addition. See docs/known-deviations.md §3.
        const totals = headers.map(() => "");
        totals[totalIndex] = total.toFixed();
        body.push(totals);
      }

      return { name: currency, headers, rows: body };
    });

  void context;

  return { sheets, skipped, warnings };
}

export const salesByCurrencyModule: ReportModule = {
  definition: {
    id: "sales_by_currency",
    label: "Sales report by currency",
    datasets: ["amazon_vat"],
    granularity: ["month", "quarter"],
    // One file covers every marketplace, so there is nothing to be missing.
    requiresEveryDataset: false,
    description: "Amazon VAT transaction report, split by settlement currency, with totals.",
    needs: "One Amazon VAT transaction report, which already covers every marketplace.",
    why: "",
    // Reads the VAT file as it stands; no per-channel rule decides anything.
    requiredRules: [],
  },
  generate(rows, context) {
    // The report reproduces the source columns, so their order comes from the
    // file rather than from a list kept in the code.
    const headers = Object.keys(rows.find((row) => row.dataset === "amazon_vat")?.raw ?? {});

    if (headers.length === 0) throw new Error("The Amazon VAT upload has no rows.");

    return generateSalesByCurrency(rows, context, headers);
  },
};
