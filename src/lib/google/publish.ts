import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

import { accessTokenFor, loadConnection } from "./connection";
import { ensureFolder, uploadFile } from "./drive";

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
    return { uploaded: 0, failed: 0, message: "Google Drive не подключён — выгрузка пропущена." };
  }

  const [run] = await db
    .select({
      periodLabel: schema.reportRuns.periodLabel,
      reportType: schema.reportRuns.reportType,
    })
    .from(schema.reportRuns)
    .where(and(eq(schema.reportRuns.id, runId), eq(schema.reportRuns.tenantId, tenantId)))
    .limit(1);

  if (!run) return { uploaded: 0, failed: 0, message: "Прогон не найден." };

  const artifacts = await db
    .select()
    .from(schema.reportArtifacts)
    .where(eq(schema.reportArtifacts.reportRunId, runId));

  if (artifacts.length === 0) {
    return { uploaded: 0, failed: 0, message: "У прогона нет файлов." };
  }

  const token = await accessTokenFor(tenantId);

  if (!token) {
    await markFailed(artifacts, "Доступ к Google отозван.");

    return {
      uploaded: 0,
      failed: artifacts.length,
      message: "Доступ к Google отозван — подключите аккаунт заново.",
    };
  }

  let folderId: string;

  try {
    // A folder per report and period, the way legacy organised them, so a
    // month's files stay together instead of piling into one directory.
    folderId = await ensureFolder(token, connection.folderId, `${run.periodLabel}`);
  } catch (error) {
    await markFailed(artifacts, (error as Error).message);

    return { uploaded: 0, failed: artifacts.length, message: (error as Error).message };
  }

  let uploaded = 0;
  let failed = 0;

  for (const artifact of artifacts) {
    if (!artifact.blobKey) continue;

    try {
      const stored = await get(artifact.blobKey, { access: "private" });

      if (!stored?.stream) throw new Error("Файл отчёта недоступен в хранилище.");

      const bytes = new Uint8Array(await new Response(stored.stream).arrayBuffer());

      const file = await uploadFile(token, {
        name: artifact.filename,
        parentFolderId: folderId,
        mimeType: XLSX_MIME,
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
        ? `Выгружено в Drive: ${uploaded}.`
        : `Выгружено ${uploaded}, не удалось ${failed}. Файлы можно скачать здесь и повторить выгрузку.`,
  };
}

async function markFailed(
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

  void reason;
}
