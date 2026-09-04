import { put } from "@vercel/blob";
import Decimal from "decimal.js";
import { and, eq, gte, inArray, lt, lte } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { log } from "@/lib/log";
import { publishRun } from "@/lib/google/publish";
import type { Period } from "@/lib/ingest/period";
import { resolveCoverage, uncoveredMonths } from "@/lib/periods/coverage";
import { euroRateOn } from "@/lib/reference/fx";

import { DATASET_NAMES } from "@/modules/channels/registry";
import { companyProfile } from "@/modules/companies/registry";
import type { CompanyProfile } from "@/modules/companies/types";
import { reportModule, variantDisplayName as variantName } from "@/modules/reports/registry";

import { reportDefinition, type ReportTypeId } from "./definitions";
import type { ReportDefinition, UnmappedSku } from "@/modules/reports/types";
import { loadReportSettings } from "./queries";
import { channelRule } from "./rules";
import { preparedGranularities, requiredDatasets } from "./settings";
import type {
  FxSnapshot,
  GeneratorResult,
  LedgerRow,
  ReportContext,
  RulesSnapshot,
} from "./types";
import { summariseWarnings } from "./warnings";
import { buildWorkbook, reportFilename } from "./workbook";

export type RunOutcome =
  | {
      ok: true;
      runId: string;
      result: GeneratorResult;
      published: { uploaded: number; failed: number; message: string };
    }
  | {
      ok: false;
      runId: string | null;
      message: string;
      needsSkuMapping?: UnmappedSku[];
      needsCurrencyMapping?: string[];
    };

/**
 * Thrown when a module's `unmappedSkus` finds SKUs the period would invoice
 * under that aren't in SKU mapping yet. Its own class, not a plain `Error`,
 * so the catch block below can carry the SKU list itself out to the caller
 * instead of just the message — the interface opens a form from it, not a
 * toast.
 */
class NeedsSkuMappingError extends Error {
  constructor(public readonly skus: UnmappedSku[]) {
    super(
      skus.length === 1
        ? skus[0].problem === "mismatch"
          ? `SKU mapping disagrees about what ${skus[0].sourceSku} is: it arrived as ` +
            `"${skus[0].sourceName}".`
          : `1 SKU used this period isn't in SKU mapping yet: ${skus[0].sourceSku}.`
        : `${skus.length} SKUs used this period aren't in SKU mapping yet, or no longer ` +
          "match what it says they are.",
    );
  }
}

/** Same idea as `NeedsSkuMappingError`, for a module's `unmappedCurrencies`. */
class NeedsCurrencyMappingError extends Error {
  constructor(public readonly currencies: string[]) {
    super(
      currencies.length === 1
        ? `1 currency used this period isn't in Allegro currency mapping yet: ${currencies[0]}.`
        : `${currencies.length} currencies used this period aren't in Allegro currency mapping yet.`,
    );
  }
}

/**
 * Builds one report and records what it was built from.
 *
 * The run is written before the work starts and closed after, so a report that
 * failed halfway leaves a row saying so rather than nothing at all. Legacy
 * deleted the whole output folder on any error, which is a clean rollback and
 * also erases the evidence of what went wrong.
 */
export async function runReport(input: {
  tenantId: string;
  reportType: ReportTypeId;
  periodLabel: string;
  requestedBy: string | null;
  /** For reports built per tenant-defined variant: which definition to build. */
  variant?: string;
}): Promise<RunOutcome> {
  const db = getDb();
  const definition = reportDefinition(input.reportType);
  const settings = (await loadReportSettings(input.tenantId))[input.reportType];

  if (!settings.enabled) {
    return {
      ok: false,
      runId: null,
      message: `"${definition.label}" is turned off in Settings -> Reports.`,
    };
  }

  // A variant report is built from one stored definition. Resolved before the
  // run exists: a run that never named its definition would explain nothing.
  let variant: { key: string; value: unknown; name: string } | null = null;

  if (definition.variants) {
    if (!input.variant) {
      return {
        ok: false,
        runId: null,
        message: `"${definition.label}" is built from a saved definition, and none was named.`,
      };
    }

    const [stored] = await db
      .select({ value: schema.channelRules.value })
      .from(schema.channelRules)
      .where(
        and(
          eq(schema.channelRules.tenantId, input.tenantId),
          eq(schema.channelRules.channel, definition.variants.rulesChannel),
          eq(schema.channelRules.key, input.variant),
        ),
      );

    if (!stored) {
      return {
        ok: false,
        runId: null,
        message:
          `There is no definition "${input.variant}" — it may have been deleted. ` +
          "Settings -> Custom reports lists the ones that exist.",
      };
    }

    variant = { key: input.variant, value: stored.value, name: variantName(stored.value, input.variant) };
  }

  // The variant's own name goes into filenames and the register, so two
  // definitions never produce workbooks that read as the same report.
  const label = variant?.name ?? definition.label;

  // The period is read from its own row rather than inferred from whichever
  // file happened to come back first. Its bounds are the report's bounds, and
  // a quarter has no file that carries them.
  const [periodRow] = await db
    .select()
    .from(schema.periods)
    .where(
      and(
        eq(schema.periods.tenantId, input.tenantId),
        eq(schema.periods.label, input.periodLabel),
      ),
    )
    .limit(1);

  if (!periodRow) {
    return {
      ok: false,
      runId: null,
      message: `There is no period ${input.periodLabel}.`,
    };
  }

  if (!definition.granularity.includes(periodRow.granularity)) {
    return {
      ok: false,
      runId: null,
      message: `"${definition.label}" is built per ${definition.granularity.join(" or ")}, and ${input.periodLabel} is a ${periodRow.granularity}.`,
    };
  }

  if (!preparedGranularities(definition, settings).includes(periodRow.granularity)) {
    return {
      ok: false,
      runId: null,
      message:
        `"${definition.label}" is not prepared per ${periodRow.granularity} for this account. ` +
        "Settings -> Reports decides which periods each report is built for.",
    };
  }

  if (settings.startsFrom && periodRow.startDate < settings.startsFrom) {
    return {
      ok: false,
      runId: null,
      message: `"${definition.label}" only starts from ${settings.startsFrom.slice(0, 7)}. ${input.periodLabel} is earlier than that.`,
    };
  }

  const today = new Date().toISOString().slice(0, 10);

  // A period still running has months that have not happened. Built anyway it
  // would look like a whole quarter and be a third short, and nothing on the
  // face of the workbook would say so.
  if (periodRow.endDate >= today) {
    return {
      ok: false,
      runId: null,
      message: `${input.periodLabel} is not over yet — it ends on ${periodRow.endDate}.`,
    };
  }

  const period: Period = {
    label: periodRow.label,
    granularity: periodRow.granularity,
    start: periodRow.startDate,
    end: periodRow.endDate,
  };

  // Files are selected by the ground they cover, not by a matching label: a
  // quarter holds no files of its own and is assembled from the months inside
  // it.
  const inRange = await db
    .select({
      id: schema.sourceFiles.id,
      dataset: schema.sourceFiles.dataset,
      countryCode: schema.sourceFiles.countryCode,
      periodStart: schema.sourceFiles.periodStart,
      periodEnd: schema.sourceFiles.periodEnd,
      granularity: schema.sourceFiles.periodGranularity,
    })
    .from(schema.sourceFiles)
    .where(
      and(
        eq(schema.sourceFiles.tenantId, input.tenantId),
        eq(schema.sourceFiles.status, "parsed"),
        inArray(schema.sourceFiles.dataset, [...definition.datasets]),
        gte(schema.sourceFiles.periodStart, period.start),
        lte(schema.sourceFiles.periodEnd, period.end),
      ),
    );

  // Coarser files win over the months they contain, so a channel that sent
  // both a quarterly export and its three monthly ones is counted once.
  const files = resolveCoverage(
    period,
    inRange.map((file) => ({
      id: file.id,
      dataset: file.dataset!,
      countryCode: file.countryCode,
      periodStart: file.periodStart!,
      periodEnd: file.periodEnd!,
      granularity: file.granularity ?? "month",
    })),
  );

  if (files.length === 0) {
    return {
      ok: false,
      runId: null,
      message: `No parsed uploads for "${definition.label}" in ${input.periodLabel}.`,
    };
  }

  const [run] = await db
    .insert(schema.reportRuns)
    .values({
      tenantId: input.tenantId,
      reportType: input.reportType,
      variant: variant?.key ?? null,
      periodId: periodRow.id,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
      status: "running",
      requestedBy: input.requestedBy,
      startedAt: new Date(),
    })
    .returning({ id: schema.reportRuns.id });

  const startedAt = Date.now();

  try {
    await db
      .insert(schema.reportRunSources)
      .values(
        files.map((file) => ({
          tenantId: input.tenantId,
          reportRunId: run.id,
          sourceFileId: file.id,
        })),
      );

    if (definition.requiresEveryDataset) {
      // Only the channels this tenant still requires. An optional channel is
      // included whenever its data exists and never blocks the build.
      //
      // Asked per month rather than per period: a quarter holding two of its
      // three months of Allegro is not a quarter with Allegro in it.
      const missing = requiredDatasets(definition, settings).filter(
        (dataset) =>
          uncoveredMonths(
            period,
            files.filter((file) => file.dataset === dataset),
          ).length > 0,
      );

      if (missing.length > 0) {
        throw new Error(
          `Missing uploads for ${input.periodLabel}: ` +
            `${missing.map((dataset) => DATASET_NAMES[dataset]).join(", ")}. ` +
            "A report built from the channels that happen to be there understates the rest.",
        );
      }
    }

    const rows = await loadLedger(
      input.tenantId,
      files.map((file) => file.id),
    );

    // The module's own completeness check — its idea of "all there", brought
    // with it rather than special-cased here.
    {
      const refusal = reportModule(input.reportType).validate?.(rows, settings);

      if (refusal) throw new Error(refusal);
    }

    const rules = await loadRules(input.tenantId);
    // The company's own facts — where its goods ship from, what its accounts
    // are called. Read here rather than reached for inside the modules, so a
    // report is a pure function of what it was handed.
    const company = await loadCompany(input.tenantId);

    // Before anything is built. A missing channel rule does not make a smaller
    // report — it makes one where every row of that channel is skipped as
    // unrecognised, while the run still reports success.
    // A rule is demanded when its channel is required, or when the channel is
    // optional but its rows are actually here — either way the generator would
    // otherwise skip every one of those rows as unrecognised.
    const requiredChannels = new Set<string>(requiredDatasets(definition, settings));
    const presentChannels = new Set(rows.map((row) => row.dataset));
    const absent = definition.requiredRules.filter(
      (required) =>
        (requiredChannels.has(required.channel) || presentChannels.has(required.channel)) &&
        channelRule(rules, required.channel, required.key) === null,
    );

    if (absent.length > 0) {
      throw new Error(
        `Channel rules are missing: ${absent
          .map((rule) => `${rule.channel} / ${rule.key}`)
          .join(", ")}. Every row from those channels would be skipped as unrecognised and the ` +
          "report would come out nearly empty. Settings -> Channel rules -> Restore missing " +
          "defaults puts them back without touching anything you have edited.",
      );
    }

    // Same idea as the channel-rules check above, one step further in: an
    // unmapped SKU does not make a smaller invoice, it makes one with the
    // channel's raw code sitting where the client's own code should be.
    const missingSkus = reportModule(input.reportType).unmappedSkus?.(rows, rules, company) ?? [];

    if (missingSkus.length > 0) throw new NeedsSkuMappingError(missingSkus);

    // Same idea, for Allegro's currency_map: a currency this file has never
    // carried before still parses cleanly (see `mapAllegro`), so nothing
    // here would notice unless it is checked explicitly — otherwise every
    // row in it is silently skipped as unrecognised.
    const missingCurrencies = reportModule(input.reportType).unmappedCurrencies?.(rows, rules) ?? [];

    if (missingCurrencies.length > 0) throw new NeedsCurrencyMappingError(missingCurrencies);

    const fx = await loadFx(rows, period);

    const result = build(input.reportType, rows, {
      period,
      rules,
      fx,
      company,
      variant: variant ? { key: variant.key, value: variant.value } : undefined,
      history: definition.historyMonths
        ? await loadHistory(input.tenantId, definition.datasets, period, definition.historyMonths)
        : undefined,
    });

    await storeArtifacts(run.id, input.tenantId, label, period.label, result);

    await db
      .update(schema.reportRuns)
      .set({
        status: "succeeded",
        finishedAt: new Date(),
        rulesSnapshot: rules,
        fxSnapshot: fx,
        stats: {
          ledgerRows: rows.length,
          outputRows: result.sheets.reduce((total, sheet) => total + sheet.rows.length, 0),
          sheets: result.sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows.length })),
          skipped: result.skipped,
          warnings: summariseWarnings(result.warnings),
          sourceFiles: files.length,
        },
      })
      .where(eq(schema.reportRuns.id, run.id));

    // Delivery is attempted here but never allowed to fail the run: the report
    // is built and downloadable, and Drive being unreachable is a separate
    // problem with its own retry.
    const published = await publishRun(input.tenantId, run.id).catch((error: Error) => ({
      uploaded: 0,
      failed: 0,
      message: error.message,
    }));

    log.info("report.built", {
      tenantId: input.tenantId,
      userId: input.requestedBy,
      entityId: run.id,
      reportType: input.reportType,
      period: period.label,
      ledgerRows: rows.length,
      outputRows: result.sheets.reduce((total, sheet) => total + sheet.rows.length, 0),
      warnings: result.warnings.length,
      driveUploaded: published.uploaded,
      driveFailed: published.failed,
      ms: Date.now() - startedAt,
    });

    return { ok: true, runId: run.id, result, published };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The report could not be built.";

    log.error("report.failed", error, {
      tenantId: input.tenantId,
      userId: input.requestedBy,
      entityId: run.id,
      reportType: input.reportType,
      period: period.label,
      sourceFiles: files.length,
      ms: Date.now() - startedAt,
    });

    // The run stays, marked failed. A report that vanished on error tells the
    // operator nothing about why.
    await db
      .update(schema.reportRuns)
      .set({ status: "failed", finishedAt: new Date(), errorMessage: message })
      .where(eq(schema.reportRuns.id, run.id));

    return {
      ok: false,
      runId: run.id,
      message,
      ...(error instanceof NeedsSkuMappingError ? { needsSkuMapping: error.skus } : {}),
      ...(error instanceof NeedsCurrencyMappingError
        ? { needsCurrencyMapping: error.currencies }
        : {}),
    };
  }
}

/**
 * Writes the workbooks and records them.
 *
 * Sales report by currency ships one file per currency, as legacy did — the
 * client's accountant works one currency at a time. The other two are a single
 * workbook.
 */
async function storeArtifacts(
  runId: string,
  tenantId: string,
  label: string,
  periodLabel: string,
  result: GeneratorResult,
): Promise<void> {
  const separate = result.sheets.length > 1 && result.sheets.every((sheet) => sheet.name.length <= 4);
  const groups = separate
    ? result.sheets.map((sheet) => ({ sheets: [sheet], suffix: sheet.name }))
    : [{ sheets: result.sheets, suffix: undefined }];

  for (const group of groups) {
    const bytes = await buildWorkbook(group.sheets);
    const filename = reportFilename(label, periodLabel, group.suffix);
    const key = `reports/${tenantId}/${runId}/${filename}`;

    // Buffer, not a bare Uint8Array: the Blob client accepts Node's Buffer and
    // this avoids a copy, since Buffer wraps the same memory.
    const blob = await put(key, Buffer.from(bytes), {
      access: "private",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    await getDb().insert(schema.reportArtifacts).values({
      tenantId,
      reportRunId: runId,
      kind: "xlsx",
      filename,
      blobKey: blob.pathname,
      sizeBytes: bytes.byteLength,
      driveStatus: "pending",
    });
  }
}

function build(
  reportType: ReportTypeId,
  rows: LedgerRow[],
  context: ReportContext,
): GeneratorResult {
  // The registry, not a switch: the core does not know the modules' names.
  return reportModule(reportType).generate(rows, context);
}

/**
 * The ledger for a run, taken from the files the run was built from.
 *
 * By file rather than by period label, because the two stopped being the same
 * question the moment a quarter could be assembled from its months: the rows
 * of a month carry that month's label, not the quarter's. Selecting by the
 * chosen files also carries the duplication rule through to the numbers — a
 * channel counted once in the sources is counted once here.
 */
async function loadLedger(tenantId: string, fileIds: string[]): Promise<LedgerRow[]> {
  const rows = await getDb()
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.tenantId, tenantId),
        inArray(schema.transactions.sourceFileId, fileIds),
        // Superseded rows are history. A report is built from what is current.
        eq(schema.transactions.isCurrent, true),
      ),
    )
    .orderBy(schema.transactions.sourceRowNumber);

  return rows.map(toLedgerRow);
}

type TransactionRow = typeof schema.transactions.$inferSelect;

function toLedgerRow(row: TransactionRow): LedgerRow {
  return {
    id: row.id,
    dataset: row.dataset,
    channel: row.channel,
    countryCode: row.countryCode,
    occurredOn: row.occurredOn,
    transactionType: row.transactionType,
    currency: row.currency,
    gross: row.gross === null ? null : new Decimal(row.gross),
    vatAmount: row.vatAmount === null ? null : new Decimal(row.vatAmount),
    netAmount: row.netAmount === null ? null : new Decimal(row.netAmount),
    sku: row.sku,
    quantity: row.quantity === null ? null : new Decimal(row.quantity),
    sourceFileId: row.sourceFileId,
    sourceRowNumber: row.sourceRowNumber,
    raw: (row.raw ?? {}) as Record<string, string>,
  };
}

/** The first day of the month `months` before `date`, as `YYYY-MM-DD`. */
function monthsBefore(date: string, months: number): string {
  const [year, month] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 - months, 1));

  return shifted.toISOString().slice(0, 10);
}

/**
 * Rows of this report's datasets from before the period, for a module that
 * asked for them.
 *
 * Selected by the date on the row rather than by file, unlike the ledger
 * itself: the question these answer is "what did this SKU sell for back then",
 * and a file's period label has no bearing on it. Superseded rows stay out,
 * same as the ledger.
 */
async function loadHistory(
  tenantId: string,
  datasets: ReportDefinition["datasets"],
  period: Period,
  months: number,
): Promise<LedgerRow[]> {
  const rows = await getDb()
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.tenantId, tenantId),
        inArray(schema.transactions.dataset, [...datasets]),
        eq(schema.transactions.isCurrent, true),
        gte(schema.transactions.occurredOn, monthsBefore(period.start, months)),
        lt(schema.transactions.occurredOn, period.start),
      ),
    )
    .orderBy(schema.transactions.occurredOn);

  return rows.map(toLedgerRow);
}

/**
 * The profile this company's reports are built from.
 *
 * Throws when the key names no profile, and that is the right answer: a
 * company created before its profile exists cannot have reports built, and
 * failing loudly beats building them from somebody else's values.
 */
async function loadCompany(tenantId: string): Promise<CompanyProfile> {
  const [row] = await getDb()
    .select({ profileKey: schema.tenants.profileKey })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);

  if (!row) throw new Error("This company no longer exists.");

  return companyProfile(row.profileKey);
}

async function loadRules(tenantId: string): Promise<RulesSnapshot> {
  const db = getDb();

  const [vatRates, sellerVatNumbers, skuMappings, channelRules] = await Promise.all([
    db
      .select({
        country: schema.vatRates.country,
        rate: schema.vatRates.rate,
        validFrom: schema.vatRates.validFrom,
        validTo: schema.vatRates.validTo,
      })
      .from(schema.vatRates)
      .where(eq(schema.vatRates.tenantId, tenantId)),

    db
      .select({
        country: schema.sellerVatNumbers.country,
        vatNumber: schema.sellerVatNumbers.vatNumber,
      })
      .from(schema.sellerVatNumbers)
      .where(eq(schema.sellerVatNumbers.tenantId, tenantId)),

    db
      .select({
        channel: schema.skuMappings.channel,
        sourceSku: schema.skuMappings.sourceSku,
        sourceName: schema.skuMappings.sourceName,
        targetSku: schema.skuMappings.targetSku,
        itemName: schema.skuMappings.itemName,
        isIgnored: schema.skuMappings.isIgnored,
      })
      .from(schema.skuMappings)
      .where(eq(schema.skuMappings.tenantId, tenantId)),

    db
      .select({
        channel: schema.channelRules.channel,
        key: schema.channelRules.key,
        value: schema.channelRules.value,
      })
      .from(schema.channelRules)
      .where(eq(schema.channelRules.tenantId, tenantId)),
  ]);

  return { vatRates, sellerVatNumbers, skuMappings, channelRules };
}

/**
 * The rate for every currency the period actually contains, as at its last day.
 *
 * The ECB does not publish at weekends, so the lookup takes the most recent
 * publication before that date and records which one it used — an invoice has
 * to be able to say where its rate came from.
 */
async function loadFx(rows: readonly LedgerRow[], period: Period): Promise<FxSnapshot> {
  const currencies = new Set(
    rows.map((row) => row.currency).filter((currency): currency is string => Boolean(currency)),
  );

  const snapshot: FxSnapshot = {};

  for (const currency of currencies) {
    const rate = await euroRateOn(currency, period.end);

    if (rate) {
      snapshot[currency] = {
        rate: rate.rate.toFixed(8),
        rateDate: rate.rateDate,
        source: rate.source,
      };
    }
  }

  return snapshot;
}
