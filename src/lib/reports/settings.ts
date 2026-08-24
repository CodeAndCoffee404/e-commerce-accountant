import type { PeriodGranularity } from "@/lib/db/schema";
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
  /**
   * Which of the periods the module supports this tenant actually prepares.
   *
   * Two different questions, kept apart: the module's `granularity` says what
   * its mathematics can do, and this says what the client files. A client who
   * reports monthly and not quarterly should not be offered quarterly
   * workbooks, and no code change should be needed to say so.
   *
   * Keyed only by what the module supports; anything unlisted is on.
   */
  granularities: Record<string, boolean>;
  /**
   * The first period this report exists for, as the ISO date its period
   * starts on (always the first of a month — `YYYY-MM-01`). `null` means no
   * floor: every period the module can build for is offered.
   *
   * A period that starts before this date is not offered, not built, and
   * does not appear on the dashboard for this report — as if the report had
   * not existed yet. Nothing about periods themselves changes; this only
   * narrows which of them this one report is willing to see.
   */
  startsFrom: string | null;
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
    granularities?: Record<string, unknown>;
    startsFrom?: unknown;
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

  const granularities: Record<string, boolean> = {};

  for (const granularity of definition.granularity) {
    granularities[granularity] = value.granularities?.[granularity] !== false;
  }

  const startsFrom =
    typeof value.startsFrom === "string" && /^\d{4}-\d{2}-01$/.test(value.startsFrom)
      ? value.startsFrom
      : null;

  return { enabled: value.enabled !== false, datasets, countries, granularities, startsFrom };
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
 * The periods this report will actually be offered for: what the module can
 * build, narrowed by what the client files.
 */
export function preparedGranularities(
  definition: ReportDefinition,
  settings: ReportSettings,
): PeriodGranularity[] {
  return definition.granularity.filter(
    (granularity) => settings.granularities[granularity] !== false,
  );
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
