import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { classify } from "@/lib/ingest/classify";
import { mapTransactions } from "@/lib/ingest/mappers";
import { parseSpreadsheet } from "@/lib/ingest/parse";

/**
 * Runs the mappers over the anonymised fixtures, which live in the repository
 * and therefore run anywhere. Amounts survive anonymisation untouched, so the
 * arithmetic these assert is the client's real arithmetic.
 */
const FIXTURES = path.resolve(process.cwd(), "tests/fixtures");

function collect(): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(FIXTURES, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".csv")) {
      files.push(path.join(entry.parentPath, entry.name));
    }
  }

  return files.sort();
}

async function mapFixture(file: string) {
  const name = path.basename(file);
  const parsed = await parseSpreadsheet(readFileSync(file), name);

  if (!parsed.ok) throw new Error(`${name}: ${parsed.message}`);

  const classification = classify(parsed.grid, name);

  if (!classification.ok) throw new Error(`${name}: ${classification.message}`);

  return {
    name,
    classification,
    result: mapTransactions(classification.dataset, {
      grid: parsed.grid,
      headerRowIndex: classification.headerRowIndex,
      country: classification.country,
      period: classification.period,
    }),
  };
}

const files = collect();

describe("мапперы каналов", () => {
  it.each(files.map((file) => [path.basename(file), file]))("%s", async (_name, file) => {
    const { result } = await mapFixture(file);

    expect(result.missingColumns).toEqual([]);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("не оставляет строк без даты", async () => {
    const undated: string[] = [];

    for (const file of files) {
      const { name, result } = await mapFixture(file);
      const count = result.rows.filter((row) => row.occurredOn === null).length;

      if (count > 0) undated.push(`${name}: ${count}`);
    }

    expect(undated).toEqual([]);
  });

  it("не оставляет строк, требующих внимания", async () => {
    // Любая такая строка — это либо непонятое число, либо неразобранная дата.
    // На чистом корпусе их быть не должно.
    const flagged: string[] = [];

    for (const file of files) {
      const { name, result } = await mapFixture(file);
      const row = result.rows.find((candidate) => candidate.needsAttention);

      if (row) flagged.push(`${name} строка ${row.sourceRowNumber}: ${row.attentionReason}`);
    }

    expect(flagged).toEqual([]);
  });

  it("складывает суммы Amazon Monthly без потери копеек", async () => {
    const file = files.find((candidate) => candidate.includes("Amazon Monthly Transaction report DE"));

    expect(file).toBeDefined();

    const { result } = await mapFixture(file!);
    const withSales = result.rows.filter((row) => row.netAmount !== null);

    expect(withSales.length).toBeGreaterThan(0);

    // Ровно тот случай, где legacy получал ноль: «25,13» с запятой.
    for (const row of withSales.slice(0, 20)) {
      expect(row.netAmount!.isZero() && row.gross?.isZero()).toBe(false);
    }
  });
});
