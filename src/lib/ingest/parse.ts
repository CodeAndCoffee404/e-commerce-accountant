import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import JSZip from "jszip";

import type { Grid } from "./classify";

export type ParseResult =
  | { ok: true; grid: Grid; format: "csv" | "xlsx"; encoding?: string; delimiter?: string }
  | { ok: false; code: ParseFailure; message: string };

export type ParseFailure = "UNSUPPORTED_FORMAT" | "LEGACY_XLS" | "UNREADABLE";

/** Rows beyond this are not needed to classify, and reading them costs memory. */
const MAX_ROWS = 200_000;

/**
 * Amazon and Allegro send UTF-8, but a file that has been through Excel on a
 * Windows machine comes back as Windows-1252. Decoding the latter as UTF-8
 * turns `é` into a replacement character, which then fails a header match for
 * no visible reason.
 */
function decode(bytes: Uint8Array): { text: string; encoding: string } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

/**
 * Counts separators outside quotes on the first few lines and takes the
 * winner. Counting on one line alone misreads a file whose first row is a
 * one-cell preamble, which is exactly how Amazon Monthly exports begin.
 */
export function detectDelimiter(text: string): string {
  const candidates = [",", ";", "\t", "|"];
  const sample = text.slice(0, 64 * 1024);
  const counts = new Map<string, number>(candidates.map((candidate) => [candidate, 0]));

  let inQuotes = false;
  let lines = 0;

  for (let index = 0; index < sample.length && lines < 20; index += 1) {
    const character = sample[index];

    if (character === '"') {
      // A doubled quote is an escaped quote, not the end of the field.
      if (inQuotes && sample[index + 1] === '"') index += 1;
      else inQuotes = !inQuotes;
      continue;
    }

    if (inQuotes) continue;

    if (character === "\n") {
      lines += 1;
      continue;
    }

    const current = counts.get(character);
    if (current !== undefined) counts.set(character, current + 1);
  }

  let best = ",";
  let bestCount = 0;

  for (const [candidate, count] of counts) {
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

function parseCsvGrid(bytes: Uint8Array): ParseResult {
  const { text, encoding } = decode(bytes);
  const delimiter = detectDelimiter(text);

  try {
    const rows = parseCsv(text, {
      delimiter,
      bom: true,
      relaxColumnCount: true,
      relaxQuotes: true,
      skipEmptyLines: false,
      to: MAX_ROWS,
      // Every value stays a string. Numeric coercion here would reformat
      // amounts and dates before anything has decided what they mean.
      cast: false,
    }) as string[][];

    return { ok: true, grid: rows, format: "csv", encoding, delimiter };
  } catch (error) {
    return {
      ok: false,
      code: "UNREADABLE",
      message: `Не удалось разобрать CSV: ${(error as Error).message}`,
    };
  }
}

/**
 * Excel stores a date as a number and a format, so the same cell reaches us as
 * a Date object in one file and as text in another. Rendering it back as an ISO
 * timestamp keeps the calendar date the file actually shows, which is what the
 * period parsers expect.
 */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) {
    const pad = (input: number) => String(input).padStart(2, "0");

    return (
      `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}` +
      ` ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`
    );
  }

  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return String(value.result ?? "");
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("hyperlink" in value) return String(value.text ?? value.hyperlink ?? "");
  }

  return String(value);
}

const SPREADSHEETML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/**
 * Cdiscount's report generator writes SpreadsheetML with the main namespace
 * bound to a prefix — `<x:workbook>`, `<x:sheets>` — which is valid XML and
 * valid OOXML. exceljs matches tag names literally, so it reads no sheets at
 * all and fails on an undefined workbook model.
 *
 * Rather than swap the library over one vendor, the prefix is removed and the
 * namespace made the default. Only the prefix bound to SpreadsheetML is
 * touched: `r:id` and the `mc:` compatibility markup have to survive, and
 * exceljs depends on them.
 */
function undoNamespacePrefix(xml: string): string {
  const binding = xml.match(
    new RegExp(`xmlns:([A-Za-z_][\\w.-]*)="${SPREADSHEETML_NS.replace(/\//g, "\\/")}"`),
  );

  if (!binding) return xml;

  const prefix = binding[1];

  return xml
    .replace(new RegExp(`xmlns:${prefix}="${SPREADSHEETML_NS}"`, "g"), `xmlns="${SPREADSHEETML_NS}"`)
    .replace(new RegExp(`<${prefix}:`, "g"), "<")
    .replace(new RegExp(`</${prefix}:`, "g"), "</");
}

async function stripNamespacePrefixes(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const parts = Object.keys(zip.files).filter(
    (name) => name.startsWith("xl/") && name.endsWith(".xml"),
  );

  for (const name of parts) {
    const xml = await zip.files[name].async("string");

    zip.file(name, undoNamespacePrefix(xml));
  }

  return zip.generateAsync({ type: "uint8array" });
}

async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();

  // Copy into a fresh ArrayBuffer: a Uint8Array view of a larger buffer would
  // hand exceljs bytes that are not the file.
  await workbook.xlsx.load(bytes.slice().buffer as ArrayBuffer);

  return workbook;
}

async function parseXlsxGrid(bytes: Uint8Array): Promise<ParseResult> {
  try {
    let workbook = await loadWorkbook(bytes).catch(() => null);

    if (!workbook || workbook.worksheets.length === 0) {
      workbook = await loadWorkbook(await stripNamespacePrefixes(bytes));
    }

    const sheet = workbook.worksheets[0];

    if (!sheet) {
      return { ok: false, code: "UNREADABLE", message: "В книге нет ни одного листа." };
    }

    const grid: string[][] = [];

    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS) return;

      const values: string[] = [];

      row.eachCell({ includeEmpty: true }, (excelCell, columnNumber) => {
        values[columnNumber - 1] = cellToString(excelCell.value);
      });

      grid[rowNumber - 1] = [...values].map((value) => value ?? "");
    });

    // eachRow skips gaps, so fill them rather than leaving holes in the array.
    for (let index = 0; index < grid.length; index += 1) grid[index] ??= [];

    return { ok: true, grid, format: "xlsx" };
  } catch (error) {
    return {
      ok: false,
      code: "UNREADABLE",
      message: `Не удалось разобрать XLSX: ${(error as Error).message}`,
    };
  }
}

/** The old binary `.xls` — an OLE compound document, not a zip. */
function isLegacyXls(bytes: Uint8Array): boolean {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

  return signature.every((byte, index) => bytes[index] === byte);
}

export async function parseSpreadsheet(bytes: Uint8Array, filename: string): Promise<ParseResult> {
  if (isLegacyXls(bytes)) {
    return {
      ok: false,
      code: "LEGACY_XLS",
      message:
        "Старый формат .xls не поддерживается. Откройте файл в Excel и сохраните как .xlsx или .csv.",
    };
  }

  const extension = filename.toLowerCase().split(".").pop() ?? "";

  if (extension === "csv" || extension === "txt") return parseCsvGrid(bytes);
  if (extension === "xlsx" || extension === "xlsm") return parseXlsxGrid(bytes);

  return {
    ok: false,
    code: "UNSUPPORTED_FORMAT",
    message: `Формат «.${extension}» не поддерживается. Загрузите .csv или .xlsx.`,
  };
}
