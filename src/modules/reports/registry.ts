import type { ReportDefinition, ReportModule, ReportTypeId } from "./types";
import { amazonZohoInvoiceModule } from "./amazon-zoho-invoice";
import { offAmazonSalesModule } from "./off-amazon-sales";
import { salesByCurrencyModule } from "./sales-by-currency";

/**
 * Every report the system can build. The core iterates this list and never
 * names a module: adding a report is a new file here plus one line below, and
 * nothing that already works is touched.
 *
 * The order is the order the cards appear in.
 */
export const REPORT_MODULES: readonly ReportModule[] = [
  salesByCurrencyModule,
  offAmazonSalesModule,
  amazonZohoInvoiceModule,
];

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = REPORT_MODULES.map(
  (module) => module.definition,
);

export function reportModule(id: ReportTypeId): ReportModule {
  const found = REPORT_MODULES.find((module) => module.definition.id === id);

  if (!found) throw new Error(`Unknown report type: ${id}`);

  return found;
}

export function reportDefinition(id: ReportTypeId): ReportDefinition {
  return reportModule(id).definition;
}

/**
 * The display name of a stored variant. Part of the variants contract: the
 * stored value carries a `name`; a malformed row falls back to its key so a
 * run's label never comes out empty.
 */
export function variantDisplayName(value: unknown, fallback: string): string {
  if (
    value !== null &&
    typeof value === "object" &&
    "name" in value &&
    typeof (value as { name: unknown }).name === "string" &&
    (value as { name: string }).name.trim() !== ""
  ) {
    return (value as { name: string }).name.trim();
  }

  return fallback;
}
