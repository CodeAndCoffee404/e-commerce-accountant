"use server";

import { del } from "@vercel/blob";
import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { record } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { log } from "@/lib/log";
import { reportDefinition } from "@/lib/reports/definitions";

export type DeleteUploadResult = { ok: boolean; message: string };

/**
 * Removes an upload, its rows, and its bytes.
 *
 * Two things make this more than a delete. A file that replaced an earlier one
 * for the same period was the only reason that earlier file stopped counting,
 * so removing it puts the earlier one back — otherwise the period would end up
 * with rows in the database that no report can see and a file listed as
 * replaced by something that no longer exists.
 *
 * And a file a report was built from is not deleted at all. The link from a run
 * to its sources is what makes the run traceable a year later; cascading it
 * away would leave a run quietly claiming fewer sources than it used. The run
 * goes first, deliberately, by hand.
 */
export async function deleteUpload(fileId: string): Promise<DeleteUploadResult> {
  const user = await requireUser();

  if (user.role === "viewer") return { ok: false, message: "Not allowed." };

  const db = getDb();

  const [file] = await db
    .select({
      id: schema.sourceFiles.id,
      filename: schema.sourceFiles.originalFilename,
      blobKey: schema.sourceFiles.blobKey,
      dataset: schema.sourceFiles.dataset,
      period: schema.sourceFiles.periodLabel,
      status: schema.sourceFiles.status,
      supersededByFileId: schema.sourceFiles.supersededByFileId,
    })
    .from(schema.sourceFiles)
    .where(
      and(eq(schema.sourceFiles.id, fileId), eq(schema.sourceFiles.tenantId, user.tenantId)),
    )
    .limit(1);

  if (!file) return { ok: false, message: "No such file." };

  const runs = await db
    .select({
      reportType: schema.reportRuns.reportType,
      period: schema.reportRuns.periodLabel,
    })
    .from(schema.reportRunSources)
    .innerJoin(schema.reportRuns, eq(schema.reportRuns.id, schema.reportRunSources.reportRunId))
    .where(
      and(
        eq(schema.reportRunSources.sourceFileId, fileId),
        eq(schema.reportRuns.tenantId, user.tenantId),
      ),
    );

  if (runs.length > 0) {
    const named = [
      ...new Set(runs.map((run) => `${reportDefinition(run.reportType).label} ${run.period}`)),
    ];

    return {
      ok: false,
      message:
        `Used to build ${named.slice(0, 3).join(", ")}` +
        `${named.length > 3 ? ` and ${named.length - 3} more` : ""}. ` +
        "Delete those reports first — a run that cannot show what it was built from is worse " +
        "than no run at all.",
    };
  }

  const restored = await db.transaction(async (tx) => {
    const replaced = await tx
      .select({ id: schema.sourceFiles.id, filename: schema.sourceFiles.originalFilename })
      .from(schema.sourceFiles)
      .where(
        and(
          eq(schema.sourceFiles.tenantId, user.tenantId),
          eq(schema.sourceFiles.supersededByFileId, fileId),
        ),
      )
      .orderBy(desc(schema.sourceFiles.uploadedAt));

    // Whether anything comes back depends on what is being deleted. Removing
    // the file that currently counts hands the period back to its predecessor.
    // Removing a file that was itself already replaced must restore nothing:
    // its successor still counts, and resurrecting the predecessor too would
    // put two versions of the period into the ledger at once — every figure
    // drawn from it doubled.
    const wasCurrent = file.status !== "superseded";
    let cameBack: { id: string; filename: string } | null = null;

    if (wasCurrent) {
      // Only the newest predecessor returns, for the same doubling reason.
      const [newest, ...older] = replaced;

      if (newest) {
        cameBack = newest;

        await tx
          .update(schema.sourceFiles)
          .set({ status: "parsed", supersededByFileId: null })
          .where(eq(schema.sourceFiles.id, newest.id));

        await tx
          .update(schema.transactions)
          .set({ isCurrent: true })
          .where(
            and(
              eq(schema.transactions.tenantId, user.tenantId),
              eq(schema.transactions.sourceFileId, newest.id),
            ),
          );

        if (older.length > 0) {
          // They stay replaced, now by the file that came back rather than by
          // one that is about to stop existing.
          await tx
            .update(schema.sourceFiles)
            .set({ supersededByFileId: newest.id })
            .where(
              sql`${schema.sourceFiles.id} = any(${sql.param(older.map((row) => row.id))}::uuid[])`,
            );
        }
      }
    } else if (replaced.length > 0) {
      // A middle link goes quietly: its predecessors stay replaced, re-pointed
      // to the successor that actually holds the period now.
      await tx
        .update(schema.sourceFiles)
        .set({ supersededByFileId: file.supersededByFileId })
        .where(
          sql`${schema.sourceFiles.id} = any(${sql.param(replaced.map((row) => row.id))}::uuid[])`,
        );
    }

    // The transactions go with it: the row has an ON DELETE CASCADE, and rows
    // pointing at a file nobody can open are unauditable by definition.
    await tx
      .delete(schema.sourceFiles)
      .where(
        and(eq(schema.sourceFiles.id, fileId), eq(schema.sourceFiles.tenantId, user.tenantId)),
      );

    return cameBack;
  });

  // After the database, not before: a failed delete that had already thrown the
  // bytes away would leave a row pointing at nothing.
  await del(file.blobKey).catch(() => undefined);

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    {
      action: "upload.deleted",
      entity: "source_file",
      entityId: fileId,
      payload: {
        filename: file.filename,
        dataset: file.dataset,
        period: file.period,
        restoredFileId: restored?.id ?? null,
      },
    },
  );

  log.info("upload.deleted", {
    tenantId: user.tenantId,
    userId: user.id,
    entityId: fileId,
    dataset: file.dataset,
    period: file.period,
    restoredFileId: restored?.id ?? null,
  });

  revalidatePath("/uploads");
  revalidatePath("/transactions");
  revalidatePath("/reports");

  return {
    ok: true,
    message: restored
      ? `Deleted. "${restored.filename}" counts again for this period.`
      : "Deleted.",
  };
}
