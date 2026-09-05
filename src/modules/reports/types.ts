import type { CompanyRules } from "@/modules/companies/types";
import type { schema } from "@/lib/db";
import type { PeriodGranularity } from "@/lib/db/schema";
import type { DatasetId } from "@/lib/ingest/datasets";
import type { ReportSettings } from "@/lib/reports/settings";
import type { GeneratorResult, LedgerRow, ReportContext, RulesSnapshot } from "@/lib/reports/types";

export type ReportTypeId = (typeof schema.reportType.enumValues)[number];

export type ReportDefinition = {
  id: ReportTypeId;
  /** Legacy's own name — it goes into the filename and the client knows it. */
  label: string;
  datasets: readonly DatasetId[];
  /**
   * The periods this report can be built for — the module's own statement
   * about its mathematics, not a tenant preference. What a tenant actually
   * wants prepared is chosen in report settings, within this list.
   *
   * Whole quarters are allowed only where legacy allowed them.
   */
  granularity: readonly PeriodGranularity[];
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
  /**
   * Channel rules the generator cannot work without.
   *
   * These are not optional settings with sensible fallbacks. Without
   * `allegro/operation_types` every Allegro sale is an unknown operation and is
   * skipped one row at a time, and the report comes out nearly empty while
   * still reporting success. Checked before a run starts, so that never
   * happens quietly.
   */
  requiredRules: readonly { channel: string; key: string }[];
  /**
   * Months of this report's own datasets to load from before the period, and
   * hand to the generator as `context.history`. Absent means a report sees its
   * own period and nothing else, which is the normal case: a report that reads
   * further back has to say so, because it stops being a pure function of the
   * month it names.
   */
  historyMonths?: number;
  /**
   * True for reports that never go into a filing. They are built on demand
   * from Reports but stay out of the month-close checklist: closing the month
   * means the official reports are built, not these.
   */
  informational?: boolean;
  /**
   * Declared when the report comes in tenant-defined variants: each variant is
   * one channel_rules row under this channel, its value carrying at least a
   * `name`. The core offers one card per variant, requires a run to name one,
   * and hands the stored value to the generator via the context. `summarise`
   * turns a stored value into the card's one-line description — the module's
   * own knowledge of its config shape, brought with it.
   */
  variants?: { rulesChannel: string; summarise: (value: unknown) => string };
};

/**
 * One report, complete: what it is, what it demands, and the mathematics.
 *
 * The contract the whole system holds a module to: standard rows in, standard
 * sheets out, everything else private. The core runs modules through this
 * interface and never learns their names — a new report is a new module and a
 * registry line, not a change to anything that already works.
 */
/**
 * One question SKU mapping could not answer, on its way to the person who can.
 *
 * It carries the pair rather than the code alone because for a channel that
 * reports an item name the mapping is a pair: a code and the name it is
 * expected to arrive with. `unmapped` is no row at all, `mismatch` is rows
 * that exist and disagree, `incomplete` is a row that does not say what to
 * bill — each a different question needing a different answer, and telling
 * them apart is what keeps the gate from asking the same thing forever.
 */
export type UnmappedSku = {
  /** Stable identity of the pair, for lists and for drafts against them. */
  key: string;
  /** What to store as `source_sku` when the person answers. */
  sourceSku: string;
  /** The name that arrived with it; empty where the channel reports none. */
  sourceName: string;
  problem: "unmapped" | "mismatch" | "incomplete";
  /** What the rows under that code expect instead. Empty unless a mismatch. */
  expectedNames: string[];
};

/** One SKU with no name to check it against — every channel but Shopify. */
export function unmappedCode(sourceSku: string): UnmappedSku {
  return { key: sourceSku, sourceSku, sourceName: "", problem: "unmapped", expectedNames: [] };
}

export type ReportModule = {
  definition: ReportDefinition;
  /**
   * A module-specific completeness check, run after the ledger is loaded and
   * before anything is built. Returns the refusal message, or null to proceed.
   * This is where a module brings its own idea of "all there" — the Zoho
   * invoice refuses on a missing marketplace, say — without the core having to
   * know it.
   */
  validate?: (rows: readonly LedgerRow[], settings: ReportSettings) => string | null;
  /**
   * SKUs this period's rows would carry into the report that SKU mapping
   * cannot answer for — the module's own idea of which of its SKUs matter,
   * since only some modules invoice by SKU at all. Checked after the ledger
   * loads and before anything builds, same as `validate`, so the question is
   * asked once rather than discovered afterwards in the workbook, silently
   * carrying a raw code or the wrong product's name.
   */
  unmappedSkus?: (
    rows: readonly LedgerRow[],
    rules: RulesSnapshot,
    company: CompanyRules,
  ) => UnmappedSku[];
  /**
   * Distinct currencies this period's rows would carry into the report that
   * have no rule to say what they mean — same idea as `unmappedSkus`, for
   * Allegro's currency_map. Allegro writes the currency next to the amount
   * rather than in its own column, so a currency the file has never used
   * before still parses cleanly; this is what stops it from being silently
   * skipped instead.
   */
  unmappedCurrencies?: (rows: readonly LedgerRow[], rules: RulesSnapshot) => string[];
  generate: (rows: LedgerRow[], context: ReportContext) => GeneratorResult;
};
