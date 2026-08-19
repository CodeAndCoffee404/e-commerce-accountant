import { z } from "zod";

/**
 * The shape of a tenant-defined custom report, shared by the generator, the
 * server actions and the settings form so all three agree on what a
 * definition is.
 *
 * A definition can only pick from a fixed catalogue of dimensions and
 * measures. That is the whole safety argument for letting it be edited in the
 * application: it filters, groups and sums ledger rows that are already
 * counted, and cannot touch VAT mathematics, exchange rates or row semantics.
 */

/** The channel_rules channel that stores the definitions, one row each. */
export const CUSTOM_REPORTS_CHANNEL = "custom_reports";

/** Ledger fields a definition may group by. Keys are LedgerRow fields. */
export const SLICE_DIMENSIONS = [
  { key: "dataset", label: "Channel" },
  { key: "countryCode", label: "Country" },
  { key: "currency", label: "Currency" },
  { key: "transactionType", label: "Type" },
  { key: "sku", label: "SKU" },
] as const;

/** What a definition may sum. `rows` is a count; the rest are ledger sums. */
export const SLICE_MEASURES = [
  { key: "rows", label: "Rows" },
  { key: "quantity", label: "Quantity" },
  { key: "gross", label: "Gross" },
  { key: "vatAmount", label: "VAT" },
  { key: "netAmount", label: "Net" },
] as const;

export type SliceDimension = (typeof SLICE_DIMENSIONS)[number]["key"];
export type SliceMeasure = (typeof SLICE_MEASURES)[number]["key"];

const dimensionKey = z.enum(["dataset", "countryCode", "currency", "transactionType", "sku"]);
const measureKey = z.enum(["rows", "quantity", "gross", "vatAmount", "netAmount"]);

const noDuplicates = (values: readonly string[]) => new Set(values).size === values.length;

/** An include-list; empty means "everything". Matched case-insensitively. */
const filterList = z.array(z.string().trim().min(1).max(120)).max(200).default([]);

export const customSliceConfigSchema = z.object({
  // The name becomes a filename and a sheet name, so the characters either of
  // those cannot carry are refused here rather than mangled later.
  name: z
    .string()
    .trim()
    .min(1, "Give the report a name.")
    .max(60, "Keep the name under 60 characters.")
    .regex(/^[^\\/:*?"<>|[\]]+$/, 'The name cannot contain \\ / : * ? " < > | [ ]'),
  groupBy: z
    .array(dimensionKey)
    .min(1, "Group by at least one field.")
    .max(5)
    .refine(noDuplicates, "Each field can be grouped by once."),
  measures: z
    .array(measureKey)
    .min(1, "Show at least one value.")
    .max(5)
    .refine(noDuplicates, "Each value can be shown once."),
  filters: z
    .object({
      datasets: filterList,
      countries: filterList,
      currencies: filterList,
      transactionTypes: filterList,
      skus: filterList,
    })
    .default({ datasets: [], countries: [], currencies: [], transactionTypes: [], skus: [] }),
});

export type CustomSliceConfig = z.output<typeof customSliceConfigSchema>;

const DIMENSION_LABELS = new Map<string, string>(
  SLICE_DIMENSIONS.map((dimension) => [dimension.key, dimension.label]),
);
const MEASURE_LABELS = new Map<string, string>(
  SLICE_MEASURES.map((measure) => [measure.key, measure.label]),
);

export function dimensionLabel(key: string): string {
  return DIMENSION_LABELS.get(key) ?? key;
}

export function measureLabel(key: string): string {
  return MEASURE_LABELS.get(key) ?? key;
}

/**
 * One sentence saying what a definition does, generated from the definition
 * itself so it can never drift from what the build will produce.
 */
export function describeConfig(
  config: CustomSliceConfig,
  channelNames?: Record<string, string>,
): string {
  const groups = config.groupBy.map(dimensionLabel).join(", ");
  const measures = config.measures.map(measureLabel).join(", ");

  const filters: string[] = [];
  const named = (values: string[]) =>
    values.map((value) => channelNames?.[value] ?? value).join(", ");

  if (config.filters.datasets.length > 0) filters.push(`channel ${named(config.filters.datasets)}`);
  if (config.filters.countries.length > 0) filters.push(`country ${named(config.filters.countries)}`);
  if (config.filters.currencies.length > 0)
    filters.push(`currency ${named(config.filters.currencies)}`);
  if (config.filters.transactionTypes.length > 0)
    filters.push(`type ${named(config.filters.transactionTypes)}`);
  if (config.filters.skus.length > 0) filters.push(`SKU ${named(config.filters.skus)}`);

  const scope =
    filters.length === 0 ? "every current row of the period" : `rows where ${filters.join("; ")}`;

  return `Groups by ${groups}; shows ${measures}; counts ${scope}.`;
}

/** The stored definition's display name, tolerant of a malformed value. */
export function customReportName(value: unknown, fallback: string): string {
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

/**
 * A stable key for a new definition, from its name. The key names the runs
 * that were built from the definition, so it never changes on rename.
 */
export function customReportKey(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return slug === "" ? "report" : slug;
}
