"use server";

import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";

import { publishRun } from "@/lib/google/publish";

import { runReport } from "./run";

export type BuildResult = { ok: true; runId: string; message: string } | { ok: false; message: string };

const buildSchema = z.object({
  reportType: z.enum(["sales_by_currency", "off_amazon_sales", "amazon_zoho_invoice"]),
  periodLabel: z.string().trim().min(1),
});

export async function buildReport(input: unknown): Promise<BuildResult> {
  const user = await requireUser();

  if (user.role === "viewer") return { ok: false, message: "Not allowed." };

  const parsed = buildSchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: "No report type or period given." };

  const outcome = await runReport({
    tenantId: user.tenantId,
    reportType: parsed.data.reportType,
    periodLabel: parsed.data.periodLabel,
    requestedBy: user.id,
  });

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    {
      action: outcome.ok ? "report.built" : "report.failed",
      entity: "report_run",
      entityId: outcome.runId ?? undefined,
      payload: {
        reportType: parsed.data.reportType,
        period: parsed.data.periodLabel,
        ...(outcome.ok ? {} : { error: outcome.message }),
      },
    },
  );

  revalidatePath("/reports");

  if (!outcome.ok) return { ok: false, message: outcome.message };

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

/**
 * Hands the file to the browser as a data URL.
 *
 * The blob itself is private, so there is no link to give out; the bytes come
 * back through the server, which also keeps the download behind the same
 * session check as everything else.
 */
export async function downloadArtifact(
  artifactId: string,
): Promise<{ ok: true; filename: string; dataUrl: string } | { ok: false; message: string }> {
  const user = await requireUser();

  const [artifact] = await getDb()
    .select({
      filename: schema.reportArtifacts.filename,
      blobKey: schema.reportArtifacts.blobKey,
    })
    .from(schema.reportArtifacts)
    .innerJoin(schema.reportRuns, eq(schema.reportRuns.id, schema.reportArtifacts.reportRunId))
    .where(
      and(
        eq(schema.reportArtifacts.id, artifactId),
        // Scoped by tenant: an artifact id alone must not reach another
        // tenant's report.
        eq(schema.reportRuns.tenantId, user.tenantId),
      ),
    )
    .limit(1);

  if (!artifact?.blobKey) return { ok: false, message: "File not found." };

  const stored = await get(artifact.blobKey, { access: "private" }).catch(() => null);

  if (!stored?.stream) return { ok: false, message: "The file is not available in storage." };

  const bytes = Buffer.from(await new Response(stored.stream).arrayBuffer());

  return {
    ok: true,
    filename: artifact.filename,
    dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${bytes.toString("base64")}`,
  };
}

/** Retry delivery for a run whose upload failed, without rebuilding it. */
export async function republish(runId: string): Promise<BuildResult> {
  const user = await requireUser();

  if (user.role === "viewer") return { ok: false, message: "Not allowed." };

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
