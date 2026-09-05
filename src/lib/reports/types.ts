import type Decimal from "decimal.js";

import type { Period } from "@/lib/ingest/period";
import type { CompanyRules } from "@/modules/companies/types";

/** One ledger row as a generator sees it. */
export type LedgerRow = {
  id: string;
  dataset: string;
  channel: string;
  countryCode: string | null;
  occurredOn: string | null;
  transactionType: string | null;
  currency: string | null;
  gross: Decimal | null;
  vatAmount: Decimal | null;
  netAmount: Decimal | null;
  sku: string | null;
  quantity: Decimal | null;
  sourceFileId: string;
  sourceRowNumber: number;
  /** The original line. Channel-specific fields the ledger does not normalise. */
  raw: Record<string, string>;
};

export type AllegroCurrencyRule = {
  country: string;
  scheme: string;
};

/**
 * Everything a generator is allowed to know, resolved once and passed in.
 *
 * A snapshot rather than a live lookup: a report has to be reproducible, and
 * that means recording the rules it ran under, not the rules as they are now.
 */
export type RulesSnapshot = {
  vatRates: { country: string; rate: string; validFrom: string; validTo: string | null }[];
  sellerVatNumbers: {
    country: string;
    /** `REGULAR` or `UNION-OSS`: which regime this registration is used under. */
    scheme: string;
    vatNumber: string;
    validFrom: string;
    validTo: string | null;
  }[];
  skuMappings: {
    channel: string;
    sourceSku: string;
    /** The name the source must carry with that code; empty means unchecked. */
    sourceName: string;
    targetSku: string | null;
    itemName: string | null;
    isIgnored: boolean;
  }[];
  channelRules: { channel: string; key: string; value: unknown }[];
};

export type FxSnapshot = {
  /** Keyed by currency: the rate into euro and the date it was published for. */
  [currency: string]: { rate: string; rateDate: string; source: string };
};

export type ReportContext = {
  period: Period;
  rules: RulesSnapshot;
  fx: FxSnapshot;
  /**
   * The company these numbers belong to: where its goods ship from, what it
   * calls its accounts in Zoho, which markets get their own VAT line. Code,
   * not settings — see `src/modules/companies/types.ts`.
   */
  company: CompanyRules;
  /** For reports built per tenant-defined variant: the stored definition. */
  variant?: { key: string; value: unknown };
  /**
   * Rows of this report's own datasets from before the period, when the module
   * asked for them (`historyMonths`). Never invoiced — they are there to answer
   * a question this period cannot, such as what a SKU normally sells for when
   * this month never sold one on its own.
   */
  history?: readonly LedgerRow[];
};

export type ReportSheet = {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
};

export type GeneratorResult = {
  sheets: ReportSheet[];
  /** Rows the generator refused, with the reason, for the run summary. */
  skipped: { reason: string; count: number }[];
  warnings: string[];
};
