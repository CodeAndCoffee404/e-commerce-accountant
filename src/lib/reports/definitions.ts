import type { DatasetId } from "@/lib/ingest/datasets";
import type { schema } from "@/lib/db";

export type ReportTypeId = (typeof schema.reportType.enumValues)[number];

export type ReportDefinition = {
  id: ReportTypeId;
  /** Legacy's own name — it goes into the filename and the client knows it. */
  label: string;
  datasets: readonly DatasetId[];
  /** Whole quarters are allowed only where legacy allowed them. */
  granularity: readonly ("month" | "quarter")[];
  /**
   * Refuse to build unless every listed dataset is present for the period.
   *
   * A report assembled from whatever happened to be uploaded looks complete
   * and is not — it understates revenue by exactly the channels nobody
   * noticed were missing.
   */
  requiresEveryDataset: boolean;
  description: string;
};

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    id: "sales_by_currency",
    label: "Sales report by currency",
    datasets: ["amazon_vat"],
    granularity: ["month", "quarter"],
    // One file covers every marketplace, so there is nothing to be missing.
    requiresEveryDataset: false,
    description: "Amazon VAT transaction report, split by settlement currency, with totals.",
  },
  {
    id: "off_amazon_sales",
    label: "Off-Amazon Sales",
    datasets: ["allegro", "cdiscount", "shopify"],
    granularity: ["month"],
    requiresEveryDataset: true,
    description: "Allegro, Cdiscount and Shopify normalised into one sheet.",
  },
  {
    id: "amazon_zoho_invoice",
    label: "Amazon invoice for Zoho",
    datasets: ["amazon_monthly"],
    // A quarter is refused: the invoice is dated the last day of the month and
    // numbered by month, so a quarter has no meaning here.
    granularity: ["month"],
    // One dataset, but ten countries — checked separately by missingCountries.
    requiresEveryDataset: false,
    description: "Ten marketplaces aggregated into invoice lines for Zoho.",
  },
];

export function reportDefinition(id: ReportTypeId): ReportDefinition {
  const found = REPORT_DEFINITIONS.find((definition) => definition.id === id);

  if (!found) throw new Error(`Unknown report type: ${id}`);

  return found;
}
