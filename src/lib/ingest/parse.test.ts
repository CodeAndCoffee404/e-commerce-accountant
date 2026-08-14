import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { classify } from "./classify";
import { detectDelimiter, parseSpreadsheet } from "./parse";

describe("detectDelimiter", () => {
  it("finds the comma in an ordinary export", () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n')).toBe(",");
  });

  it("ignores separators inside quotes", () => {
    expect(detectDelimiter('"a;b;c";d\n"1;2;3";4\n')).toBe(";");
  });

  it("looks past a one-cell preamble", () => {
    // Amazon Monthly exports open with several lines of prose before the
    // header, and counting only the first line would find no separator at all.
    const text = ['"Includes Marketplace transactions"', '"All amounts in EUR"', "a,b,c,d", "1,2,3,4"].join("\n");

    expect(detectDelimiter(text)).toBe(",");
  });
});

const FIXTURES = path.resolve(process.cwd(), "tests/fixtures");

function anyFixture(): string {
  for (const entry of readdirSync(FIXTURES, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".csv")) {
      return path.join(entry.parentPath, entry.name);
    }
  }

  throw new Error("no fixtures");
}

describe("parseSpreadsheet", () => {
  /**
   * Guards a bug that took two runs to catch: the workbook was handed
   * `bytes.slice().buffer`, and Node's Buffer slices a view rather than a copy,
   * so `.buffer` was the shared allocation pool with other files' bytes in it.
   * The same file parsed differently depending on what had been read before.
   */
  it("reads the same file the same way whatever was read before it", async () => {
    const file = anyFixture();
    const name = path.basename(file);
    const bytes = readFileSync(file);

    const first = await parseSpreadsheet(bytes, name);

    // Fill the pool with something else, exactly as a batch of uploads would.
    for (let index = 0; index < 20; index += 1) {
      readFileSync(file);
      Buffer.allocUnsafe(1024).fill(index);
    }

    const second = await parseSpreadsheet(readFileSync(file), name);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.grid.length).toBe(first.grid.length);
    expect(second.grid[0]).toEqual(first.grid[0]);
    expect(classify(second.grid, name)).toEqual(classify(first.grid, name));
  });

  it("refuses the old binary .xls with an instruction, not a stack trace", async () => {
    // OLE compound document signature — what Excel 97-2003 writes.
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const result = await parseSpreadsheet(ole, "report.xls");

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("LEGACY_XLS");
    expect(result.message).toContain(".xlsx");
  });

  it("names the format it will not take", async () => {
    const result = await parseSpreadsheet(new Uint8Array([1, 2, 3]), "report.pdf");

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("UNSUPPORTED_FORMAT");
    expect(result.message).toContain(".pdf");
  });
});
