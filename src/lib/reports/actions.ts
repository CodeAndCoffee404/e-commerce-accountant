"use server";

import { del } from "@vercel/blob";
import { and, eq } from "drizzle-orm";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { can, requireAccess } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { log } from "@/lib/log";

import { publishRun } from "@/lib/google/publish";

import { runReport } from "./run";

export type BuildResult =
  | { ok: true; runId: string; message: string }
  | {
      ok: false;
      message: string;
      /** Set when the refusal is specifically unmapped SKUs — the interface opens the mapping form instead of just a toast. */
      needsSkuMapping?: string[];
      /** Same idea, for an Allegro currency with no rule in currency_map yet. */
      needsCurrencyMapping?: string[];
    };

const buildSchema = z.object({
  reportType: z.enum([
    "sales_by_currency",
    "off_amazon_sales",
    "amazon_zoho_invoice",
    "allegro_zoho_invoice",
    "shopify_zoho_invoice",
  ]),
  periodLabel: z.string().trim().min(1),
  /** For reports built per tenant-defined variant: which definition. */
  variant: z.string().trim().min(1).max(100).optional(),
});

export async function buildReport(input: unknown): Promise<BuildResult> {
  const user = await requireAccess();

  if (!can(user, "reports", "edit")) return { ok: false, message: "Not allowed." };

  const parsed = buildSchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: "No report type or period given." };

  const outcome = await runReport({
    tenantId: user.tenantId,
    reportType: parsed.data.reportType,
    periodLabel: parsed.data.periodLabel,
    requestedBy: user.id,
    variant: parsed.data.variant,
  });

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    {
      action: outcome.ok ? "report.built" : "report.failed",
      entity: "report_run",
      entityId: outcome.runId ?? undefined,
      payload: {
        reportType: parsed.data.reportType,
        ...(parsed.data.variant ? { variant: parsed.data.variant } : {}),
        period: parsed.data.periodLabel,
        ...(outcome.ok ? {} : { error: outcome.message }),
      },
    },
  );

  revalidatePath("/reports");

  if (!outcome.ok) {
    return {
      ok: false,
      message: outcome.message,
      ...(outcome.needsSkuMapping ? { needsSkuMapping: outcome.needsSkuMapping } : {}),
      ...(outcome.needsCurrencyMapping
        ? { needsCurrencyMapping: outcome.needsCurrencyMapping }
        : {}),
    };
  }

  const rows = outcome.result.sheets.reduce((total, sheet) => total + sheet.rows.length, 0);
  const warnings = outcome.result.warnings.length;

  return {
    ok: true,
    runId: outcome.runId,
    message:
      warnings === 0
        ? `Done: ${rows} rows.`
        : `Done: ${rows} rows, ${warnings} warnings.`,
  };
}

/** Retry delivery for a run whose upload failed, without rebuilding it. */
export async function republish(runId: string): Promise<BuildResult> {
  const user = await requireAccess();

  if (!can(user, "reports", "edit")) return { ok: false, message: "Not allowed." };

  const result = await publishRun(user.tenantId, runId);

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    {
      action: "report.republished",
      entity: "report_run",
      entityId: runId,
      payload: { uploaded: result.uploaded, failed: result.failed },
    },
  );

  revalidatePath("/reports");

  return result.failed === 0 && result.uploaded > 0
    ? { ok: true, runId, message: result.message }
    : { ok: false, message: result.message };
}

/**
 * Removes a run and its files.
 *
 * A failed or superseded run is clutter in a register that has to stay
 * readable. The workbooks go with it — keeping bytes nothing points at is how
 * storage fills with things nobody dares delete later. What is already in the
 * client's Drive stays: it is their file now, and reaching into their Drive to
 * take it back is not this application's business.
 */
export async function deleteRun(runId: string): Promise<BuildResult> {
  const user = await requireAccess();

  if (!can(user, "reports", "edit")) return { ok: false, message: "Not allowed." };

  const db = getDb();

  const artifacts = await db
    .select({ id: schema.reportArtifacts.id, blobKey: schema.reportArtifacts.blobKey })
    .from(schema.reportArtifacts)
    .innerJoin(schema.reportRuns, eq(schema.reportRuns.id, schema.reportArtifacts.reportRunId))
    .where(
      and(eq(schema.reportArtifacts.reportRunId, runId), eq(schema.reportRuns.tenantId, user.tenantId)),
    );

  const [deleted] = await db
    .delete(schema.reportRuns)
    .where(and(eq(schema.reportRuns.id, runId), eq(schema.reportRuns.tenantId, user.tenantId)))
    .returning({ id: schema.reportRuns.id, period: schema.reportRuns.periodLabel });

  if (!deleted) return { ok: false, message: "No such report." };

  for (const artifact of artifacts) {
    if (artifact.blobKey) await del(artifact.blobKey).catch(() => undefined);
  }

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    { action: "report.deleted", entity: "report_run", entityId: runId, payload: { period: deleted.period } },
  );

  log.info("report.deleted", { tenantId: user.tenantId, userId: user.id, entityId: runId });
  revalidatePath("/reports");

  return { ok: true, runId, message: "Report removed." };
}
