import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import { classify } from "@/lib/ingest/classify";
import { parseSpreadsheet } from "@/lib/ingest/parse";
import { generateSalesByCurrency, TOTAL_COLUMN } from "@/modules/reports/sales-by-currency";

import { corpusAvailable, ledgerForPeriod, readGolden, REPORTS, seededRules } from "./harness";

import { monthByNumber } from "@/lib/ingest/months";
import { buildPeriod, collectPeriods } from "@/lib/ingest/period";
import { GEYSER } from "@/modules/companies/geyser";

const PERIODS = ["2026.06 June", "2026.07 July"];

function periodOf(label: string) {
  const [year, rest] = label.split(".");
  const month = monthByNumber(Number(rest.slice(0, 2)));

  if (!month) throw new Error(`could not read the period ${label}`);

  const built = buildPeriod(collectPeriods([{ year: Number(year), month }]));

  if (!built.ok) throw new Error(built.reason);

  return built.period;
}

/** The source headers, in file order — the report reproduces them unchanged. */
async function sourceHeaders(label: string): Promise<string[]> {
  const directory = path.resolve(
    process.cwd(),
    "docs/legacy-gas/exported-reports/Report Automation/Amazon VAT transaction report",
  );
  const name = readdirSync(directory).find(
    (entry) => entry.includes(label) && entry.endsWith(".csv"),
  );

  if (!name) throw new Error(`no Amazon VAT source for ${label}`);

  const parsed = await parseSpreadsheet(readFileSync(path.join(directory, name)), name);

  if (!parsed.ok) throw new Error(parsed.message);

  const classification = classify(parsed.grid, name);

  if (!classification.ok) throw new Error(classification.message);

  return [...(parsed.grid[classification.headerRowIndex] ?? [])].map((value) =>
    (value ?? "").replace(/^﻿/, "").trim(),
  );
}

describe.skipIf(!corpusAvailable)("Sales report by currency against the reference", () => {
  it.each(PERIODS)("%s", async (label) => {
    const headers = await sourceHeaders(label);
    const ledger = await ledgerForPeriod(label, ["amazon_vat"]);

    const result = generateSalesByCurrency(
      ledger,
      { period: periodOf(label), rules: seededRules(), fx: {}, company: GEYSER },
      headers,
    );

    const directory = path.join(REPORTS, `Sales report by currency - ${label}`);
    const currencies = readdirSync(directory)
      .filter((name) => name.endsWith(".xlsx"))
      .map((name) => name.replace(/^.* - /, "").replace(/\.xlsx$/, ""))
      .sort();

    expect(result.sheets.map((sheet) => sheet.name)).toEqual(currencies);

    for (const sheet of result.sheets) {
      const golden = await readGolden(
        path.join(directory, `Sales report by currency - ${label} - ${sheet.name}.xlsx`),
      );

      // The last row of each is the total; the rest are the source rows.
      const ourBody = sheet.rows.slice(0, -1);
      const theirBody = golden.rows.slice(0, -1);

      expect(ourBody.length, `${sheet.name}: row count`).toBe(theirBody.length);

      const totalIndex = headers.indexOf(TOTAL_COLUMN);
      const sum = (rows: (string | number | null)[][]) =>
        rows.reduce(
          (total, row) => total.plus(new Decimal(String(row[totalIndex] || "0"))),
          new Decimal(0),
        );

      const ourTotal = new Decimal(String(sheet.rows.at(-1)?.[totalIndex] ?? "0"));
      const theirTotal = new Decimal(String(golden.rows.at(-1)?.[totalIndex] ?? "0"));

      // Ours is the exact sum of its own rows; legacy's carries float drift, so
      // the two are compared within a cent. See docs/known-deviations.md §3.
      expect(ourTotal.toFixed(), `${sheet.name}: the total is the exact sum of its rows`).toBe(
        sum(ourBody).toFixed(),
      );
      expect(
        ourTotal.minus(theirTotal).abs().lte("0.005"),
        `${sheet.name}: total ${ourTotal.toFixed()} against ${theirTotal.toFixed()}`,
      ).toBe(true);
    }
  }, 180_000);
});
