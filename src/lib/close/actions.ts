"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { log } from "@/lib/log";
import { REPORT_DEFINITIONS } from "@/lib/reports/definitions";
import { availablePeriods } from "@/lib/reports/queries";
import { runReport } from "@/lib/reports/run";

export type BuildAllResult = { ok: boolean; message: string };

const inputSchema = z.object({ periodLabel: z.string().trim().min(1) });

/**
 * Builds every report the month is ready for, in one press.
 *
 * "Ready for" means: enabled, every required input present, and either never
 * built successfully for this month or built before a re-upload made the run
 * stale. Reports already built and still fresh are left alone — the register
 * stays quiet unless something actually needs doing.
 */
export async function buildAllReady(raw: { periodLabel: string }): Promise<BuildAllResult> {
  const user = await requireUser();

  if (user.role === "viewer") return { ok: false, message: "Not allowed." };

  const input = inputSchema.parse(raw);
  const db = getDb();
  const availability = await availablePeriods(user.tenantId);

  // Latest run per type for the month, to know what is already done.
  const runs = await db
    .select({
      id: schema.reportRuns.id,
      reportType: schema.reportRuns.reportType,
      status: schema.reportRuns.status,
      createdAt: schema.reportRuns.createdAt,
    })
    .from(schema.reportRuns)
    .where(
      and(
        eq(schema.reportRuns.tenantId, user.tenantId),
        eq(schema.reportRuns.periodLabel, input.periodLabel),
      ),
    )
    .orderBy(schema.reportRuns.createdAt);

  const latest = new Map<string, { id: string; status: string }>();

  for (const run of runs) latest.set(run.reportType, { id: run.id, status: run.status });

  const staleRunIds = new Set<string>();

  const succeededIds = [...latest.values()]
    .filter((run) => run.status === "succeeded")
    .map((run) => run.id);

  if (succeededIds.length > 0) {
    const sources = await db
      .select({ runId: schema.reportRunSources.reportRunId, status: schema.sourceFiles.status })
      .from(schema.reportRunSources)
      .innerJoin(
        schema.sourceFiles,
        eq(schema.sourceFiles.id, schema.reportRunSources.sourceFileId),
      )
      .where(inArray(schema.reportRunSources.reportRunId, succeededIds));

    for (const source of sources) {
      if (source.status === "superseded") staleRunIds.add(source.runId);
    }
  }

  const targets = REPORT_DEFINITIONS.filter((definition) => {
    const available = availability[definition.id];

    if (!available?.enabled) return false;
    if (!available.ready.includes(input.periodLabel)) return false;

    const run = latest.get(definition.id);

    // Never built, last attempt failed, or built from since-replaced sources.
    return !run || run.status !== "succeeded" || staleRunIds.has(run.id);
  });

  if (targets.length === 0) {
    return { ok: true, message: "Nothing to build — everything ready is already built." };
  }

  const built: string[] = [];
  const failed: string[] = [];

  // One after another: each run reads the whole ledger slice and writes
  // workbooks, and two at once would fight for memory to no one's benefit.
  for (const definition of targets) {
    const outcome = await runReport({
      tenantId: user.tenantId,
      reportType: definition.id,
      periodLabel: input.periodLabel,
      requestedBy: user.id,
    });

    await record(
      { id: user.id, email: user.email, tenantId: user.tenantId },
      {
        action: outcome.ok ? "report.built" : "report.failed",
        entity: "report_run",
        entityId: outcome.runId ?? undefined,
        payload: {
          reportType: definition.id,
          period: input.periodLabel,
          via: "month_close",
          ...(outcome.ok ? {} : { error: outcome.message }),
        },
      },
    );

    if (outcome.ok) built.push(definition.label);
    else failed.push(`${definition.label}: ${outcome.message}`);
  }

  log.info("close.build_all", {
    tenantId: user.tenantId,
    userId: user.id,
    period: input.periodLabel,
    built: built.length,
    failed: failed.length,
  });

  revalidatePath("/close");
  revalidatePath("/reports");

  if (failed.length === 0) {
    return { ok: true, message: `Built: ${built.join(", ")}.` };
  }

  return {
    ok: false,
    message:
      (built.length > 0 ? `Built: ${built.join(", ")}. ` : "") + `Failed — ${failed.join("; ")}`,
  };
}
