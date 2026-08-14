import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

import { accessTokenFor, loadConnection } from "./connection";
import { reportDefinition } from "@/lib/reports/definitions";

import { ensureFolder, GOOGLE_SHEET_MIME, uploadFile } from "./drive";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type PublishResult = {
  uploaded: number;
  failed: number;
  message: string;
};

/**
 * Copies a run's workbooks into the client's Drive.
 *
 * Never throws at the caller. A report that is built and downloadable has done
 * its job; Drive being unreachable is a delivery problem, and failing the whole
 * report over it would throw away the work and tell the operator nothing about
 * the numbers.
 */
export async function publishRun(tenantId: string, runId: string): Promise<PublishResult> {
  const db = getDb();
  const connection = await loadConnection(tenantId);

  if (!connection?.folderId) {
    return { uploaded: 0, failed: 0, message: "Google Drive is not connected — upload skipped." };
  }

  const [run] = await db
    .select({
      periodLabel: schema.reportRuns.periodLabel,
      reportType: schema.reportRuns.reportType,
    })
    .from(schema.reportRuns)
    .where(and(eq(schema.reportRuns.id, runId), eq(schema.reportRuns.tenantId, tenantId)))
    .limit(1);

  if (!run) return { uploaded: 0, failed: 0, message: "Run not found." };

  const artifacts = await db
    .select()
    .from(schema.reportArtifacts)
    .where(eq(schema.reportArtifacts.reportRunId, runId));

  if (artifacts.length === 0) {
    return { uploaded: 0, failed: 0, message: "The run produced no files." };
  }

  const token = await accessTokenFor(tenantId);

  if (!token) {
    await markFailed(tenantId, artifacts, "Google access was revoked.");

    return {
      uploaded: 0,
      failed: artifacts.length,
      message: "Google access was revoked — connect the account again.",
    };
  }

  let folderId: string;

  try {
    // `<Report> - <Period>`, the way legacy named its folders. A folder per
    // period alone would mix three different reports for the same month.
    const label = reportDefinition(run.reportType).label;

    folderId = await ensureFolder(token, connection.folderId, `${label} - ${run.periodLabel}`);
  } catch (error) {
    await markFailed(tenantId, artifacts, (error as Error).message);

    return { uploaded: 0, failed: artifacts.length, message: (error as Error).message };
  }

  let uploaded = 0;
  let failed = 0;

  for (const artifact of artifacts) {
    if (!artifact.blobKey) continue;

    try {
      const stored = await get(artifact.blobKey, { access: "private" });

      if (!stored?.stream) throw new Error("The report file is not available in storage.");

      const bytes = new Uint8Array(await new Response(stored.stream).arrayBuffer());

      const file = await uploadFile(token, {
        // Without the extension: the file arrives as a Google Sheet, and
        // `… .xlsx` on a Sheet reads as a mistake.
        name: artifact.filename.replace(/\.xlsx$/i, ""),
        parentFolderId: folderId,
        mimeType: XLSX_MIME,
        convertTo: GOOGLE_SHEET_MIME,
        bytes,
      });

      await db
        .update(schema.reportArtifacts)
        .set({
          driveFileId: file.id,
          driveUrl: file.webViewLink,
          driveStatus: "synced",
          driveSyncedAt: new Date(),
        })
        .where(eq(schema.reportArtifacts.id, artifact.id));

      uploaded += 1;
    } catch (error) {
      await db
        .update(schema.reportArtifacts)
        .set({ driveStatus: "failed", driveUrl: null })
        .where(eq(schema.reportArtifacts.id, artifact.id));

      await db
        .update(schema.googleConnections)
        .set({ lastError: (error as Error).message })
        .where(eq(schema.googleConnections.tenantId, tenantId));

      failed += 1;
    }
  }

  return {
    uploaded,
    failed,
    message:
      failed === 0
        ? `Uploaded to Drive: ${uploaded}.`
        : `Uploaded ${uploaded}, failed ${failed}. The files are downloadable here and the upload can be retried.`,
  };
}

/**
 * Marks the run's files undelivered and records why.
 *
 * The reason lands on the connection, which is where the settings screen shows
 * it: the failure is almost always about the connection rather than about one
 * file, and an operator asking "why is nothing arriving" looks there.
 */
async function markFailed(
  tenantId: string,
  artifacts: { id: string }[],
  reason: string,
): Promise<void> {
  const db = getDb();

  for (const artifact of artifacts) {
    await db
      .update(schema.reportArtifacts)
      .set({ driveStatus: "failed" })
      .where(eq(schema.reportArtifacts.id, artifact.id));
  }

  await db
    .update(schema.googleConnections)
    .set({ lastError: reason })
    .where(eq(schema.googleConnections.tenantId, tenantId));
}
