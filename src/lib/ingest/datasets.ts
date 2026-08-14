export type DatasetId =
  | "amazon_vat"
  | "amazon_monthly"
  | "allegro"
  | "cdiscount"
  | "shopify";

export type PeriodResolver =
  | "amazon_vat"
  | "allegro"
  | "cdiscount"
  | "shopify";

/**
 * The recognition profile of a fixed-header channel. The profiles themselves
 * live with their modules in src/modules/channels; this is the shared shape
 * the toolkit classifies with.
 */
export type SimpleDataset = {
  id: Exclude<DatasetId, "amazon_monthly">;
  /** Kept identical to legacy: it is what the report registry matches on. */
  label: string;
  headerRowIndex: number;
  requiredHeaders: readonly string[];
  periodResolver: PeriodResolver;
  periodColumn: string;
  /** Amazon VAT derives its period from AFN rows only. */
  periodFilterColumn?: string;
  periodFilterValue?: string;
};

export type AmazonCountry = "ES" | "IT" | "FR" | "DE" | "UK" | "SE" | "PL" | "NL" | "IE" | "BE";

export function amazonMonthlyLabel(country: AmazonCountry): string {
  return `Amazon Monthly Transaction report ${country}`;
}
