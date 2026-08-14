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
  /**
   * What the report needs, in plain words, said before anything is uploaded.
   * Someone should be able to tell what to go and fetch without having to
   * discover it by watching a button stay grey.
   */
  needs: string;
  /**
   * Why it refuses to build without them. Shown next to what is missing,
   * because "you cannot" invites working around it and "here is what would go
   * wrong" does not.
   */
  why: string;
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
    needs: "One Amazon VAT transaction report, which already covers every marketplace.",
    why: "",
  },
  {
    id: "off_amazon_sales",
    label: "Off-Amazon Sales",
    datasets: ["allegro", "cdiscount", "shopify"],
    granularity: ["month"],
    requiresEveryDataset: true,
    description: "Allegro, Cdiscount and Shopify normalised into one sheet.",
    needs: "Allegro, Cdiscount and Shopify, all three for the same month.",
    why:
      "Built from whichever channels happen to be uploaded, the sheet looks complete and " +
      "understates revenue by exactly the ones nobody noticed were absent.",
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
    needs: "Amazon Monthly for all ten marketplaces: ES, IT, FR, DE, UK, SE, PL, NL, IE, BE.",
    why:
      "A missing marketplace does not make a smaller invoice. It makes one that leaves a " +
      "country's sales out in silence, and nothing downstream would show it.",
  },
];

export function reportDefinition(id: ReportTypeId): ReportDefinition {
  const found = REPORT_DEFINITIONS.find((definition) => definition.id === id);

  if (!found) throw new Error(`Unknown report type: ${id}`);

  return found;
}
