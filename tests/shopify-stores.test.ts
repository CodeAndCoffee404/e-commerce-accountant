import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { classify, type Grid } from "@/lib/ingest/classify";
import { parseSpreadsheet } from "@/lib/ingest/parse";
import { channelModule } from "@/modules/channels/registry";

/**
 * Two Shopify shops, one account, and exports whose columns are identical to
 * the letter — the same header row, in the same order. Nothing but the
 * contents can say which shop a file came from, and getting it wrong means an
 * invoice issued by the wrong company in the wrong currency.
 */
const GEYSER = "tests/fixtures/from-csv/Geyser shopify sales report - 2026.07 July.csv";
const WATERLIFT = "tests/fixtures/from-csv/Waterlift shopify sales report - 2026.06 June.csv";

async function gridOf(relative: string): Promise<Grid> {
  const file = path.resolve(process.cwd(), relative);
  const parsed = await parseSpreadsheet(readFileSync(file), path.basename(file));

  if (!parsed.ok) throw new Error(parsed.message);

  return parsed.grid;
}

function rows(grid: Grid): string[][] {
  return grid.map((row) => [...row]);
}

function columnIndex(grid: Grid, header: string): number {
  const found = (grid[0] ?? []).findIndex((value) => value.trim() === header);

  if (found === -1) throw new Error(`No column ${header}`);

  return found;
}

function setColumn(grid: string[][], header: string, value: (previous: string) => string): string[][] {
  const index = columnIndex(grid, header);

  return grid.map((row, rowIndex) =>
    rowIndex === 0 ? row : row.map((cell, cellIndex) => (cellIndex === index ? value(cell) : cell)),
  );
}

describe("telling the two Shopify shops apart", () => {
  it("has identical headers in both exports, so only the contents can decide", async () => {
    const geyser = await gridOf(GEYSER);
    const waterlift = await gridOf(WATERLIFT);

    expect(waterlift[0]).toEqual(geyser[0]);
  });

  it("files each shop's export under its own dataset", async () => {
    const geyser = classify(await gridOf(GEYSER), "whatever.csv");
    const waterlift = classify(await gridOf(WATERLIFT), "whatever.csv");

    expect(geyser.ok && geyser.dataset).toBe("shopify_geyser");
    expect(waterlift.ok && waterlift.dataset).toBe("shopify_waterlift");
  });

  it("decides on the file, not on its name", async () => {
    // The name is the one thing a person renames by hand; it must not vote.
    const result = classify(await gridOf(WATERLIFT), "Geyser shopify sales report - 2026.06 June.csv");

    expect(result.ok && result.dataset).toBe("shopify_waterlift");
  });

  it("is not thrown by the few rows that honestly look like the other shop", async () => {
    // A European order billed to an American address is an ordinary sale, not
    // a Waterlift one. Some rows will always look like the other shop.
    const grid = rows(await gridOf(GEYSER));
    const country = columnIndex(grid, "Billing Country");
    let stamped = 0;

    for (const row of grid.slice(1)) {
      if (row[country] === "" || stamped >= 4) continue;

      row[country] = "US";
      stamped += 1;
    }

    expect(stamped).toBe(4);

    const result = classify(grid, "whatever.csv");

    // A few dissenting rows are outvoted by the rest of the file, which is the
    // whole reason the shop is decided by a majority and not by one row.
    expect(result.ok && result.dataset).toBe("shopify_geyser");
  });

  it("refuses a file that is half one shop and half the other", async () => {
    const geyser = rows(await gridOf(GEYSER));
    const waterlift = rows(await gridOf(WATERLIFT));
    const merged = [...geyser, ...waterlift.slice(1)];

    const result = classify(merged, "whatever.csv");

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("VARIANT_NOT_DETECTED");
    // The message has to name both shops and the split, or the person holding
    // the file has nothing to act on.
    expect(result.message).toContain("Geyser shopify sales report");
    expect(result.message).toContain("Waterlift shopify sales report");
  });

  it("refuses a file that says nothing about which shop it is", async () => {
    let grid = rows(await gridOf(WATERLIFT));

    for (const header of ["Currency", "Billing Country"]) {
      grid = setColumn(grid, header, () => "");
    }

    const result = classify(grid, "whatever.csv");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VARIANT_NOT_DETECTED");
  });

  it("maps each shop's rows into its own channel, and never the other's", async () => {
    const grid = await gridOf(WATERLIFT);
    const classified = classify(grid, "whatever.csv");

    if (!classified.ok) throw new Error(classified.message);

    const { rows: mapped } = channelModule(classified.dataset).map({
      grid,
      headerRowIndex: classified.headerRowIndex,
      country: null,
      period: classified.period,
    });

    expect(mapped.length).toBeGreaterThan(0);
    expect(new Set(mapped.map((row) => row.dataset))).toEqual(new Set(["shopify_waterlift"]));
    expect(new Set(mapped.map((row) => row.channel))).toEqual(new Set(["shopify_waterlift"]));
    // Where the goods leave from is an agreed rule for the European shop and
    // has never been agreed for this one; the ledger says so rather than
    // borrowing Spain.
    expect(new Set(mapped.map((row) => row.departureCountry))).toEqual(new Set([null]));
  });
});
