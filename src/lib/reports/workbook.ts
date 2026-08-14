import ExcelJS from "exceljs";

import type { ReportSheet } from "./types";

/**
 * Sheet names Excel will accept: no `\ / ? * [ ]`, at most 31 characters, and
 * not empty. A rejected name fails the whole workbook, so it is fixed here
 * rather than left to whatever a currency code or a channel is called.
 */
export function safeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31);

  return cleaned === "" ? fallback : cleaned;
}

/**
 * Writes the generated sheets into a workbook.
 *
 * Values are written as they were generated — numbers as numbers so a
 * spreadsheet can sum them, everything else as text. What is emphatically not
 * written is a formula: the whole production bug this system replaces came from
 * a spreadsheet computing a price out of cells it had stored as text.
 */
export async function buildWorkbook(sheets: readonly ReportSheet[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "E-commerce Accountant";

  for (const [index, sheet] of sheets.entries()) {
    const worksheet = workbook.addWorksheet(safeSheetName(sheet.name, `Sheet${index + 1}`));

    worksheet.addRow(sheet.headers);
    worksheet.getRow(1).font = { bold: true };

    for (const row of sheet.rows) {
      worksheet.addRow(row.map(toCell));
    }

    worksheet.columns.forEach((column, columnIndex) => {
      const header = sheet.headers[columnIndex] ?? "";

      column.width = Math.min(40, Math.max(12, header.length + 2));
    });

    worksheet.views = [{ state: "frozen", ySplit: 1 }];
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new Uint8Array(buffer);
}

/**
 * A numeric string becomes a number so the sheet can be summed; anything else
 * stays text. Amounts keep their exact decimal form because the string came
 * from decimal arithmetic, not from a float.
 */
function toCell(value: string | number | null): string | number | null {
  if (value === null || value === "") return null;
  if (typeof value === "number") return value;

  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
}

/** `Off-Amazon Sales - 2026.07 July.xlsx`, the name legacy used. */
export function reportFilename(label: string, periodLabel: string, suffix?: string): string {
  const base = suffix ? `${label} - ${periodLabel} - ${suffix}` : `${label} - ${periodLabel}`;

  return `${base}.xlsx`;
}
