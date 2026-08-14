import type Decimal from "decimal.js";

import type { Grid } from "../classify";
import {
  NumberFormatError,
  parseDecimalValue,
  type DecimalSeparator,
} from "../numbers";

/**
 * Header names carry a BOM in the first cell, stray non-breaking spaces, and in
 * one Amazon locale a trailing colon. Comparison is on the cleaned, upper-cased
 * form so a mapping does not have to reproduce those quirks.
 */
function normalise(value: string | undefined, isFirstCell: boolean): string {
  let text = value ?? "";

  if (isFirstCell) text = text.replace(/^﻿/, "");

  return text.replace(/ /g, " ").trim().replace(/:\s*$/, "").trim().toUpperCase();
}

export class RowReader {
  private readonly indexes = new Map<string, number>();
  private readonly missing = new Set<string>();

  constructor(
    private readonly grid: Grid,
    private readonly headerRowIndex: number,
    private readonly decimalSeparator: DecimalSeparator,
  ) {
    const header = grid[headerRowIndex] ?? [];

    for (const [index, value] of header.entries()) {
      const key = normalise(value, index === 0);

      // First occurrence wins: a duplicate header is almost always a trailing
      // empty column, and overwriting would point the mapping at nothing.
      if (key !== "" && !this.indexes.has(key)) this.indexes.set(key, index);
    }
  }

  get headers(): string[] {
    return [...(this.grid[this.headerRowIndex] ?? [])];
  }

  get firstDataRow(): number {
    return this.headerRowIndex + 1;
  }

  get rowCount(): number {
    return this.grid.length;
  }

  /** Records the name when absent, so the caller can report it once. */
  has(column: string): boolean {
    const found = this.indexes.has(normalise(column, false));

    if (!found) this.missing.add(column);

    return found;
  }

  get missingColumns(): string[] {
    return [...this.missing];
  }

  text(rowIndex: number, column: string): string | null {
    const index = this.indexes.get(normalise(column, false));

    if (index === undefined) {
      this.missing.add(column);
      return null;
    }

    const value = (this.grid[rowIndex]?.[index] ?? "").trim();

    return value === "" ? null : value;
  }

  /** First of several candidate names that the file actually has. */
  textOf(rowIndex: number, columns: readonly string[]): string | null {
    for (const column of columns) {
      if (this.indexes.has(normalise(column, false))) return this.text(rowIndex, column);
    }

    for (const column of columns) this.missing.add(column);

    return null;
  }

  /**
   * Returns the parsed value, or the error, rather than throwing. A single
   * unreadable cell should flag its row for attention, not abort the file —
   * the operator needs to see which row is wrong.
   */
  decimal(rowIndex: number, column: string): { value: Decimal | null } | { error: string } {
    const raw = this.text(rowIndex, column);

    try {
      return { value: parseDecimalValue(raw, { decimalSeparator: this.decimalSeparator, column }) };
    } catch (error) {
      if (error instanceof NumberFormatError) return { error: error.message };

      throw error;
    }
  }

  decimalOf(
    rowIndex: number,
    columns: readonly string[],
  ): { value: Decimal | null } | { error: string } {
    for (const column of columns) {
      if (this.indexes.has(normalise(column, false))) return this.decimal(rowIndex, column);
    }

    for (const column of columns) this.missing.add(column);

    return { value: null };
  }

  /** The whole row keyed by header, kept for drill-down and for support. */
  raw(rowIndex: number): Record<string, string> {
    const header = this.grid[this.headerRowIndex] ?? [];
    const row = this.grid[rowIndex] ?? [];
    const record: Record<string, string> = {};

    for (const [index, name] of header.entries()) {
      const key = (name ?? "").replace(/^﻿/, "").trim();
      const value = (row[index] ?? "").trim();

      if (key !== "" && value !== "") record[key] = value;
    }

    return record;
  }

  isBlank(rowIndex: number): boolean {
    return (this.grid[rowIndex] ?? []).every((value) => (value ?? "").trim() === "");
  }
}

/** Collects the reasons a row needs a human to look at it. */
export class Attention {
  private readonly reasons: string[] = [];

  add(reason: string | null | undefined): void {
    if (reason && !this.reasons.includes(reason)) this.reasons.push(reason);
  }

  /** Unwraps a reader result, recording the failure instead of throwing. */
  take(result: { value: Decimal | null } | { error: string }): Decimal | null {
    if ("error" in result) {
      this.add(result.error);
      return null;
    }

    return result.value;
  }

  get needsAttention(): boolean {
    return this.reasons.length > 0;
  }

  get reason(): string | null {
    return this.reasons.length === 0 ? null : this.reasons.join("; ");
  }
}
