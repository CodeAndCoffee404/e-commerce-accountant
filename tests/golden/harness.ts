import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import Decimal from "decimal.js";

import { classify } from "@/lib/ingest/classify";
import { channelModule } from "@/modules/channels/registry";
import { parseSpreadsheet } from "@/lib/ingest/parse";
import { ALLEGRO_CURRENCY_MAP, RULES_EFFECTIVE_FROM } from "@/lib/reference/seed-data";
import { GEYSER } from "@/modules/companies/geyser";
import type { LedgerRow, RulesSnapshot } from "@/lib/reports/types";

export const CORPUS = path.resolve(
  process.cwd(),
  "docs/legacy-gas/exported-reports/Report Automation",
);

export const REPORTS = path.join(CORPUS, "Reports");

export const corpusAvailable = (() => {
  try {
    return readdirSync(CORPUS).length > 0;
  } catch {
    return false;
  }
})();

/**
 * The rules a fresh Geyser starts with, without a database.
 *
 * Read from the company profile rather than from the seed tables directly, so
 * that these tests run against what `createCompany` actually writes. Taking
 * them from anywhere else would let the two drift and leave the goldens
 * passing against values production no longer seeds.
 */
export function seededRules(): RulesSnapshot {
  const seeds = GEYSER.seeds;

  return {
    vatRates: seeds.vatRates.map((rate) => ({
      country: rate.country,
      rate: rate.rate,
      validFrom: RULES_EFFECTIVE_FROM,
      validTo: null,
    })),
    sellerVatNumbers: seeds.sellerVatNumbers.map((entry) => ({
      country: entry.country,
      scheme: entry.scheme,
      vatNumber: entry.vatNumber,
      validFrom: RULES_EFFECTIVE_FROM,
      validTo: null,
    })),
    skuMappings: [
      ...seeds.skuMappings.map((mapping) => ({ ...mapping, sourceName: "", isIgnored: false })),
      ...seeds.ignoredSkus.map((sku) => ({
        channel: "amazon",
        sourceSku: sku,
        sourceName: "",
        targetSku: null,
        itemName: null,
        isIgnored: true,
      })),
    ],
    channelRules: seeds.channelRules.map((rule) => ({
      channel: rule.channel,
      key: rule.key,
      value: rule.value,
    })),
  };
}

export { ALLEGRO_CURRENCY_MAP };

function findFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "Reports") files.push(...findFiles(full));
    } else if (/\.(csv|xlsx)$/i.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

const decimal = (value: string | null) => (value === null ? null : new Decimal(value));

/**
 * Rebuilds the ledger for one period straight from the source exports, without
 * a database. A golden test compares the generator's output against what
 * legacy shipped, so the fewer moving parts between file and figure, the more
 * a mismatch means.
 *
 * CSV is preferred where both formats exist: the pair is the same export saved
 * twice, and the XLSX copy has been through Google Sheets.
 */
/**
 * A re-upload carries the moment it was taken in its name:
 * `… 2026.07 July - 2026.08.11 09-45-56.csv`. A file without one is the
 * original, so it sorts oldest.
 */
function reuploadStamp(name: string): string {
  const match = name.match(/ - (\d{4}\.\d{2}\.\d{2} \d{2}-\d{2}-\d{2})\./);

  return match ? match[1] : "";
}

export async function ledgerForPeriod(
  periodLabel: string,
  datasets: readonly string[],
): Promise<LedgerRow[]> {
  const candidates: { file: string; name: string }[] = [];

  for (const file of findFiles(CORPUS)) {
    const name = path.basename(file);

    if (!name.includes(periodLabel)) continue;
    // The archive keeps duplicates as `… July(1).xlsx`; they are the same file.
    if (/\(\d+\)\.(csv|xlsx)$/i.test(name)) continue;

    candidates.push({ file, name });
  }

  // One file per slice, exactly as the ledger does it: a second upload for the
  // same country and month supersedes the first. Belgium's July is in the
  // corpus twice, and taking both doubled its quantities.
  const bySlice = new Map<string, { file: string; name: string; stamp: string }>();

  for (const candidate of candidates) {
    const parsed = await parseSpreadsheet(readFileSync(candidate.file), candidate.name);

    if (!parsed.ok) throw new Error(`${candidate.name}: ${parsed.message}`);

    const classification = classify(parsed.grid, candidate.name);

    if (!classification.ok) throw new Error(`${candidate.name}: ${classification.message}`);
    if (!datasets.includes(classification.dataset)) continue;

    const slice = [
      classification.dataset,
      classification.country ?? "",
      classification.period.label,
    ].join("|");
    const stamp = reuploadStamp(candidate.name);
    const chosen = bySlice.get(slice);

    const better =
      !chosen ||
      stamp > chosen.stamp ||
      // Same version in both formats: the CSV has not been through Sheets.
      (stamp === chosen.stamp && chosen.file.endsWith(".xlsx") && candidate.file.endsWith(".csv"));

    if (better) bySlice.set(slice, { ...candidate, stamp });
  }

  const rows: LedgerRow[] = [];

  for (const { file } of bySlice.values()) {
    const name = path.basename(file);
    const parsed = await parseSpreadsheet(readFileSync(file), name);

    if (!parsed.ok) throw new Error(`${name}: ${parsed.message}`);

    const classification = classify(parsed.grid, name);

    if (!classification.ok) throw new Error(`${name}: ${classification.message}`);
    if (!datasets.includes(classification.dataset)) continue;

    const mapped = channelModule(classification.dataset).map({
      grid: parsed.grid,
      headerRowIndex: classification.headerRowIndex,
      country: classification.country,
      period: classification.period,
    });

    for (const row of mapped.rows) {
      rows.push({
        id: `${name}:${row.sourceRowNumber}`,
        dataset: row.dataset,
        channel: row.channel,
        countryCode: row.countryCode,
        occurredOn: row.occurredOn,
        transactionType: row.transactionType,
        currency: row.currency,
        gross: row.gross,
        vatAmount: row.vatAmount,
        netAmount: row.netAmount,
        sku: row.sku,
        quantity: row.quantity,
        sourceFileId: name,
        sourceRowNumber: row.sourceRowNumber,
        raw: row.raw,
      });
    }
  }

  return rows;
}

export type GoldenSheet = { headers: string[]; rows: string[][] };

/** Reads a legacy report, dropping the blank rows its writer pads sheets with. */
export async function readGolden(file: string): Promise<GoldenSheet> {
  const parsed = await parseSpreadsheet(readFileSync(file), path.basename(file));

  if (!parsed.ok) throw new Error(`${path.basename(file)}: ${parsed.message}`);

  const [headers, ...body] = parsed.grid.map((row) => [...row].map((value) => value ?? ""));

  return {
    headers: headers ?? [],
    rows: body.filter((row) => row.some((value) => value.trim() !== "")),
  };
}

/**
 * Compares two amounts as numbers, not as text.
 *
 * Legacy computed in binary floating point, so its totals carry artefacts like
 * `913.8299999999998`. Comparing the strings would fail on arithmetic that is
 * in fact more correct than the reference.
 */
export function sameAmount(ours: string, theirs: string, tolerance = "0.005"): boolean {
  if (ours.trim() === "" && theirs.trim() === "") return true;

  try {
    return new Decimal(ours).minus(new Decimal(theirs)).abs().lte(new Decimal(tolerance));
  } catch {
    return ours.trim() === theirs.trim();
  }
}

export { decimal };
