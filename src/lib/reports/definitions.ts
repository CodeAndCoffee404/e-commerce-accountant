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
  description: string;
};

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    id: "sales_by_currency",
    label: "Sales report by currency",
    datasets: ["amazon_vat"],
    granularity: ["month", "quarter"],
    description: "Amazon VAT transaction report, split by settlement currency, with totals.",
  },
  {
    id: "off_amazon_sales",
    label: "Off-Amazon Sales",
    datasets: ["allegro", "cdiscount", "shopify"],
    granularity: ["month"],
    description: "Allegro, Cdiscount and Shopify normalised into one sheet.",
  },
  {
    id: "amazon_zoho_invoice",
    label: "Amazon invoice for Zoho",
    datasets: ["amazon_monthly"],
    // A quarter is refused: the invoice is dated the last day of the month and
    // numbered by month, so a quarter has no meaning here.
    granularity: ["month"],
    description: "Ten marketplaces aggregated into invoice lines for Zoho.",
  },
];

export function reportDefinition(id: ReportTypeId): ReportDefinition {
  const found = REPORT_DEFINITIONS.find((definition) => definition.id === id);

  if (!found) throw new Error(`Unknown report type: ${id}`);

  return found;
}
