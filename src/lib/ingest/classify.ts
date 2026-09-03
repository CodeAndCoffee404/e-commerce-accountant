import { CHANNEL_MODULES } from "@/modules/channels/registry";

import type { AmazonCountry, DatasetId } from "./datasets";
import type { Period } from "./period";

export type Grid = readonly (readonly string[])[];

export type Classification =
  | {
      ok: true;
      dataset: DatasetId;
      label: string;
      country: AmazonCountry | null;
      marketplace: string | null;
      headerRowIndex: number;
      period: Period;
      /** How the period was established, for display and for support. */
      periodSource: "data" | "filename";
    }
  | {
      ok: false;
      /** Present once the layout was recognised but something else failed. */
      dataset: DatasetId | null;
      label: string | null;
      headerRowIndex: number | null;
      code: RejectCode;
      message: string;
    };

export type RejectCode =
  | "EMPTY_FILE"
  | "TYPE_NOT_DETECTED"
  | "PERIOD_COLUMN_NOT_FOUND"
  | "PERIOD_INVALID"
  | "COUNTRY_NOT_DETECTED"
  | "VARIANT_NOT_DETECTED";

/**
 * Works out what a spreadsheet is by asking each channel module in turn.
 *
 * The core knows no channel by name: a module either recognises the grid and
 * answers, declines with null so the next one is tried, or refuses outright —
 * a refusal means the layout matched but something else was wrong, and no
 * other module could own the file.
 */
export function classify(grid: Grid, filename: string): Classification {
  if (grid.length === 0) {
    return {
      ok: false,
      dataset: null,
      label: null,
      headerRowIndex: null,
      code: "EMPTY_FILE",
      message: "The file is empty.",
    };
  }

  for (const channel of CHANNEL_MODULES) {
    const result = channel.classify(grid, filename);

    if (result) return result;
  }

  return {
    ok: false,
    dataset: null,
    label: null,
    headerRowIndex: null,
    code: "TYPE_NOT_DETECTED",
    message: "Report type not recognised: no set of required headers matched.",
  };
}
