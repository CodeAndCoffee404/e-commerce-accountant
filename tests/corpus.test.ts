import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { classify } from "@/lib/ingest/classify";
import { parseSpreadsheet } from "@/lib/ingest/parse";

/**
 * The real client exports. They hold buyer personal data and are gitignored, so
 * this suite reports itself skipped on a machine that does not have them.
 *
 * The bar is the one agreed in PLAN §5, stage 1: every export classifies, and
 * nothing lands in "not recognised" that should have been recognised.
 */
const CORPUS = path.resolve(process.cwd(), "docs/legacy-gas/exported-reports");

/** Generated reports, not inputs — classifying them is not the job. */
const OUTPUT_DIRECTORY = "Reports";

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => null);

  if (!entries) return [];

  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === OUTPUT_DIRECTORY) continue;

      files.push(...(await collectFiles(full)));
      continue;
    }

    if (/\.(csv|xlsx)$/i.test(entry.name)) files.push(full);
  }

  return files;
}

/**
 * The archive names every file `<type> - <period>.<ext>`, so the expectation is
 * readable straight off the name. That is not what the classifier reads: it
 * works from the contents, and for Amazon Monthly from the period in the name
 * but never the type.
 */
function expectationFromName(file: string): { label: string; period: string } | null {
  const name = path.basename(file).replace(/\.(csv|xlsx)$/i, "");
  const match = name.match(/^(.+?) - (\d{4}\.(?:\d{2} \w+|Q\d))(?:\(\d+\))?$/);

  return match ? { label: match[1], period: match[2] } : null;
}

const files = await collectFiles(CORPUS);

describe.skipIf(files.length === 0)("корпус реальных выгрузок", () => {
  it("содержит ожидаемое число файлов", () => {
    expect(files.length).toBeGreaterThanOrEqual(98);
  });

  it("классифицирует каждую выгрузку", async () => {
    const failures: string[] = [];

    for (const file of files) {
      const parsed = await parseSpreadsheet(readFileSync(file), path.basename(file));

      if (!parsed.ok) {
        failures.push(`${path.basename(file)} — разбор: ${parsed.code}`);
        continue;
      }

      const result = classify(parsed.grid, path.basename(file));

      if (!result.ok) {
        failures.push(`${path.basename(file)} — ${result.code}: ${result.message}`);
        continue;
      }

      const expected = expectationFromName(file);
      if (!expected) continue;

      if (result.label !== expected.label) {
        failures.push(`${path.basename(file)} — тип «${result.label}», ожидался «${expected.label}»`);
      }

      if (result.period.label !== expected.period) {
        failures.push(
          `${path.basename(file)} — период «${result.period.label}», ожидался «${expected.period}»`,
        );
      }
    }

    expect(failures).toEqual([]);
  }, 120_000);
});
