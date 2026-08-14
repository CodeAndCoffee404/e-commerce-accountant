import { desc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

export type UploadRow = {
  id: string;
  filename: string;
  label: string | null;
  country: string | null;
  period: string | null;
  status: string;
  sizeBytes: number;
  uploadedAt: Date;
  format: string | null;
  rowCount: number | null;
  periodSource: string | null;
};

type DetectionMeta = {
  format?: string;
  rowCount?: number;
  periodSource?: string;
};

export async function listUploads(tenantId: string, limit = 200): Promise<UploadRow[]> {
  const rows = await getDb()
    .select({
      id: schema.sourceFiles.id,
      filename: schema.sourceFiles.originalFilename,
      label: schema.sourceFiles.datasetLabel,
      country: schema.sourceFiles.countryCode,
      period: schema.sourceFiles.periodLabel,
      status: schema.sourceFiles.status,
      sizeBytes: schema.sourceFiles.sizeBytes,
      uploadedAt: schema.sourceFiles.uploadedAt,
      detectionMeta: schema.sourceFiles.detectionMeta,
    })
    .from(schema.sourceFiles)
    .where(eq(schema.sourceFiles.tenantId, tenantId))
    .orderBy(desc(schema.sourceFiles.uploadedAt))
    .limit(limit);

  return rows.map((row) => {
    const meta = (row.detectionMeta ?? {}) as DetectionMeta;

    return {
      id: row.id,
      filename: row.filename,
      label: row.label,
      country: row.country,
      period: row.period,
      status: row.status,
      sizeBytes: row.sizeBytes,
      uploadedAt: row.uploadedAt,
      format: meta.format ?? null,
      rowCount: meta.rowCount ?? null,
      periodSource: meta.periodSource ?? null,
    };
  });
}
