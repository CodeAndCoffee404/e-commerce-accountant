import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { classify } from "@/lib/ingest/classify";
import { parseSpreadsheet } from "@/lib/ingest/parse";

/**
 * The anonymised fixtures, which are safe to keep in the repository — see
 * scripts/anonymise-fixtures.mts. They run everywhere, unlike the corpus suite,
 * which needs the client's real exports.
 *
 * Each fixture is named `<type> - <period>.csv`, and that name is the
 * expectation. The classifier never reads it, except for Amazon Monthly, where
 * the period may come from the filename by design.
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

const files = collect();

describe("the anonymised fixtures", () => {
  it("cover every channel and every Amazon country", () => {
    const covered = new Set(files.map((file) => path.basename(file).split(" - ")[0]));

    const expected = [
      "Allegro sales report",
      "Amazon VAT transaction report",
      "Cdiscount sales report",
      "Geyser shopify sales report",
      ...["BE", "DE", "ES", "FR", "IE", "IT", "NL", "PL", "SE", "UK"].map(
        (country) => `Amazon Monthly Transaction report ${country}`,
      ),
    ];

    expect([...covered].sort()).toEqual([...expected].sort());
  });

  it("cover both source formats, which serialise dates differently", () => {
    const directories = new Set(files.map((file) => path.basename(path.dirname(file))));

    expect([...directories].sort()).toEqual(["from-csv", "from-xlsx"]);
  });

  it.each(files.map((file) => [path.basename(path.dirname(file)), path.basename(file), file]))(
    "%s/%s",
    async (_directory, name, file) => {
      const parsed = await parseSpreadsheet(readFileSync(file), name);

      expect(parsed.ok, parsed.ok ? "" : parsed.message).toBe(true);
      if (!parsed.ok) return;

      const result = classify(parsed.grid, name);

      expect(result.ok, result.ok ? "" : result.message).toBe(true);
      if (!result.ok) return;

      const expected = name.replace(/\.csv$/i, "").match(/^(.+?) - (\d{4}\.(?:\d{2} \w+|Q\d))$/);

      expect(expected).not.toBeNull();
      expect(result.label).toBe(expected?.[1]);
      expect(result.period.label).toBe(expected?.[2]);
    },
  );

  it("contain no real email addresses", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const domains = [...text.matchAll(/[\w.+-]+@([\w.-]+)/g)].map((match) => match[1]);

      expect(new Set(domains).size <= 1).toBe(true);
      for (const domain of domains) expect(domain).toBe("example.invalid");
    }
  });
});
