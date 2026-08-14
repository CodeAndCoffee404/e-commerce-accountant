"use server";

import { createHash } from "node:crypto";

import { del, get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { classify } from "@/lib/ingest/classify";
import { parseSpreadsheet } from "@/lib/ingest/parse";

import { MAX_UPLOAD_BYTES } from "./constants";

const inputSchema = z.object({
  pathname: z.string().min(1),
  url: z.string().url(),
  filename: z.string().min(1),
  contentType: z.string().optional(),
});

export type RegisterInput = z.infer<typeof inputSchema>;

export type RegisterResult =
  | { ok: true; id: string; label: string; period: string }
  | { ok: false; message: string };

/**
 * Called by the browser once the direct-to-Blob upload resolves. Reads the
 * file back, fingerprints it, works out what it is, and records it.
 *
 * The blob is deleted again whenever the file is not accepted. Keeping the
 * bytes of a rejected upload would leave buyer personal data lying in storage
 * that nothing references and nothing cleans up.
 */
export async function registerUpload(raw: RegisterInput): Promise<RegisterResult> {
  const user = await requireUser();
  const input = inputSchema.parse(raw);
  const db = getDb();

  const bytes = await readBlob(input.pathname);

  if (!bytes) {
    return { ok: false, message: "Файл не найден в хранилище — попробуйте загрузить ещё раз." };
  }

  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    await discard(input.pathname);
    return { ok: false, message: "Файл больше 20 МБ." };
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const [duplicate] = await db
    .select({ filename: schema.sourceFiles.originalFilename })
    .from(schema.sourceFiles)
    .where(
      and(eq(schema.sourceFiles.tenantId, user.tenantId), eq(schema.sourceFiles.sha256, sha256)),
    )
    .limit(1);

  if (duplicate) {
    await discard(input.pathname);

    return {
      ok: false,
      message: `Такой файл уже загружен ранее как «${duplicate.filename}» — содержимое совпадает побайтово.`,
    };
  }

  const parsed = await parseSpreadsheet(bytes, input.filename);

  if (!parsed.ok) {
    await discard(input.pathname);
    return { ok: false, message: parsed.message };
  }

  const classification = classify(parsed.grid, input.filename);

  if (!classification.ok) {
    await discard(input.pathname);
    return { ok: false, message: classification.message };
  }

  const [row] = await db
    .insert(schema.sourceFiles)
    .values({
      tenantId: user.tenantId,
      originalFilename: input.filename,
      mimeType: input.contentType ?? null,
      sizeBytes: bytes.byteLength,
      sha256,
      blobKey: input.pathname,
      blobUrl: input.url,
      uploadedBy: user.id,
      dataset: classification.dataset,
      datasetLabel: classification.label,
      countryCode: classification.country,
      periodLabel: classification.period.label,
      periodStart: classification.period.start,
      periodEnd: classification.period.end,
      periodGranularity: classification.period.granularity,
      headerRowIndex: classification.headerRowIndex,
      detectionMeta: {
        format: parsed.format,
        encoding: parsed.encoding,
        delimiter: parsed.delimiter,
        marketplace: classification.marketplace,
        periodSource: classification.periodSource,
        rowCount: parsed.grid.length,
      },
      status: "classified",
    })
    .returning({ id: schema.sourceFiles.id });

  revalidatePath("/uploads");

  return {
    ok: true,
    id: row.id,
    label: classification.label,
    period: classification.period.label,
  };
}

async function readBlob(pathname: string): Promise<Uint8Array | null> {
  try {
    // Private store: the URL alone is not enough, the read goes through the
    // store token so the exports are never fetchable by link.
    const result = await get(pathname, { access: "private" });

    if (!result?.stream) return null;

    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function discard(pathname: string): Promise<void> {
  await del(pathname).catch(() => undefined);
}
