import type Decimal from "decimal.js";

import type { Grid } from "../classify";
import type { AmazonCountry, DatasetId } from "../datasets";
import type { Period } from "../period";

export type MapContext = {
  grid: Grid;
  headerRowIndex: number;
  country: AmazonCountry | null;
  period: Period;
};

/**
 * One normalised row. Money stays a Decimal until it reaches Postgres, where
 * it becomes numeric — never a float, at any point in between.
 */
export type MappedTransaction = {
  sourceRowNumber: number;
  dataset: DatasetId;
  channel: string;
  countryCode: string | null;

  naturalKey: string | null;
  occurredOn: string | null;
  transactionType: string | null;

  currency: string | null;
  gross: Decimal | null;
  vatAmount: Decimal | null;
  netAmount: Decimal | null;
  vatRate: Decimal | null;

  departureCountry: string | null;
  arrivalCountry: string | null;
  sellerVatNumber: string | null;
  buyerVatNumber: string | null;
  taxScheme: string | null;

  sku: string | null;
  quantity: Decimal | null;

  needsAttention: boolean;
  attentionReason: string | null;

  raw: Record<string, string>;
};

export type MapResult = {
  rows: MappedTransaction[];
  /** Columns the channel was expected to have and did not. */
  missingColumns: string[];
};

export type Mapper = (context: MapContext) => MapResult;
