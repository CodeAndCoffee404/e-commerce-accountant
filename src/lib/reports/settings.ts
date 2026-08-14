import type { DatasetId } from "@/lib/ingest/datasets";
import { DATASET_NAMES } from "@/modules/channels/registry";

import { REPORT_DEFINITIONS, type ReportDefinition, type ReportTypeId } from "./definitions";
import { ZOHO_COUNTRIES } from "@/modules/reports/amazon-zoho-invoice";

/**
 * Per-tenant configuration of the reports themselves: which ones exist, and
 * what each one insists on before it will build.
 *
 * "Required" and "optional" rather than present-or-removed, deliberately. A
 * channel the client has retired should stop blocking builds — but if a file
 * for it does arrive, its rows must still be counted. Removing the channel
 * outright would silently drop data that exists, which is the one failure this
 * system is built to never commit.
 */
export type Requirement = "required" | "optional";

export type ReportSettings = {
  /** A disabled report is hidden from the Reports page and refuses to build. */
  enabled: boolean;
  /** Requirement per dataset the report reads. Anything unlisted is required. */
  datasets: Record<string, Requirement>;
  /** Zoho only: requirement per marketplace. Anything unlisted is required. */
  countries: Record<string, Requirement>;
};

export type AllReportSettings = Record<ReportTypeId, ReportSettings>;



/**
 * Turns whatever is stored into a full, trustworthy settings object.
 *
 * Every field falls back to the strict default — enabled, everything
 * required — so a missing row, a half-written value or a report added after
 * the row was saved all behave exactly as the system behaved before settings
 * existed.
 */
export function normaliseSettings(definition: ReportDefinition, raw: unknown): ReportSettings {
  const value = (raw ?? {}) as {
    enabled?: unknown;
    datasets?: Record<string, unknown>;
    countries?: Record<string, unknown>;
  };

  const datasets: Record<string, Requirement> = {};

  for (const dataset of definition.datasets) {
    datasets[dataset] = value.datasets?.[dataset] === "optional" ? "optional" : "required";
  }

  const countries: Record<string, Requirement> = {};

  if (definition.id === "amazon_zoho_invoice") {
    for (const country of ZOHO_COUNTRIES) {
      countries[country] = value.countries?.[country] === "optional" ? "optional" : "required";
    }
  }

  return { enabled: value.enabled !== false, datasets, countries };
}

export function defaultSettings(): AllReportSettings {
  const result = {} as AllReportSettings;

  for (const definition of REPORT_DEFINITIONS) {
    result[definition.id] = normaliseSettings(definition, undefined);
  }

  return result;
}

export function requiredDatasets(
  definition: ReportDefinition,
  settings: ReportSettings,
): DatasetId[] {
  return definition.datasets.filter((dataset) => settings.datasets[dataset] !== "optional");
}

export function requiredCountries(settings: ReportSettings): string[] {
  return ZOHO_COUNTRIES.filter((country) => settings.countries[country] !== "optional");
}

/**
 * The "Needs" line on a report card, honest about the current configuration.
 * The hand-written default text survives while nothing is marked optional; the
 * moment something is, the text is generated so it can never drift from what
 * the build will actually demand.
 */
export function describeNeeds(definition: ReportDefinition, settings: ReportSettings): string {
  if (definition.id === "off_amazon_sales") {
    const required = requiredDatasets(definition, settings).map((d) => DATASET_NAMES[d]);
    const optional = definition.datasets
      .filter((dataset) => settings.datasets[dataset] === "optional")
      .map((d) => DATASET_NAMES[d]);

    if (optional.length === 0) return definition.needs;

    if (required.length === 0) {
      return (
        "Any of Allegro, Cdiscount and Shopify — every channel is optional, so the report " +
        "builds from whatever happens to be uploaded."
      );
    }

    return (
      `${listNames(required)} for the month. ` +
      `Optional and included when present: ${listNames(optional)}.`
    );
  }

  if (definition.id === "amazon_zoho_invoice") {
    const required = requiredCountries(settings);
    const optional = ZOHO_COUNTRIES.filter((c) => settings.countries[c] === "optional");

    if (optional.length === 0) return definition.needs;

    if (required.length === 0) {
      return "Amazon Monthly for any marketplace — all ten are optional, so whatever is uploaded is invoiced.";
    }

    return (
      `Amazon Monthly for ${required.join(", ")}. ` +
      `Optional and invoiced when present: ${optional.join(", ")}.`
    );
  }

  return definition.needs;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
