export type DatasetId =
  | "amazon_vat"
  | "amazon_monthly"
  | "allegro"
  | "cdiscount"
  | "cdiscount_orders"
  | "shopify_geyser"
  | "shopify_waterlift";

export type PeriodResolver =
  | "amazon_vat"
  | "allegro"
  | "cdiscount"
  | "cdiscount_orders"
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

/**
 * One signal that tells apart two exports of the same shape.
 *
 * Two Shopify stores export identical columns, so the header row cannot say
 * which store a file came from — only its contents can. A signal reads one
 * column and, for the values it recognises, casts a vote for a dataset; a
 * value it does not recognise casts none, so an unknown country or a blank
 * carry-down row never pushes a file either way.
 */
export type VariantSignal = {
  column: string;
  /** Uppercased cell value → the dataset it votes for. */
  votes: Readonly<Record<string, DatasetId>>;
};

/**
 * A family of datasets that share one header layout and are told apart by
 * their contents. The vote is deliberately blunt: a clear majority decides,
 * and anything less is refused rather than guessed at, because a file filed
 * under the wrong store is invoiced to the wrong company.
 */
export type DatasetVariants = {
  /** The datasets in play, each with the label its files are known by. */
  members: readonly { id: DatasetId; label: string }[];
  signals: readonly VariantSignal[];
  /** The share of the cast votes the winner must hold, 0..1. */
  majority: number;
  /** Below this many votes in total the file is refused as too thin to judge. */
  minimumVotes: number;
};

export type AmazonCountry = "ES" | "IT" | "FR" | "DE" | "UK" | "SE" | "PL" | "NL" | "IE" | "BE";

export function amazonMonthlyLabel(country: AmazonCountry): string {
  return `Amazon Monthly Transaction report ${country}`;
}
