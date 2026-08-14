"use server";

import { createHash } from "node:crypto";

import { del, get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";
import { log } from "@/lib/log";
import { getDb, schema } from "@/lib/db";
import { classify } from "@/lib/ingest/classify";
import { parseSpreadsheet } from "@/lib/ingest/parse";

import { MAX_UPLOAD_BYTES } from "./constants";
import { ingestSourceFile } from "./ingest";
import { isOwnUpload } from "./paths";

const inputSchema = z.object({
  pathname: z.string().min(1),
  url: z.string().url(),
  filename: z.string().min(1),
  contentType: z.string().optional(),
});

export type RegisterInput = z.infer<typeof inputSchema>;

export type RegisterResult =
  | {
      ok: true;
      id: string;
      label: string;
      period: string;
      transactions: number;
      supersededRows: number;
      needsAttention: number;
    }
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

  // Checked before a single byte is touched. `pathname` comes from the browser,
  // and this function both reads it and deletes it when a file is refused —
  // without this, naming another tenant's object would disclose it or destroy
  // it.
  if (!isOwnUpload(input.pathname, user.tenantId)) {
    // Worth a warning rather than a note: the browser cannot produce this path
    // by accident, so either something is broken or someone is probing.
    log.warn("upload.foreign_path", { tenantId: user.tenantId, userId: user.id });

    return { ok: false, message: "That file does not belong to this account." };
  }

  const bytes = await readBlob(input.pathname);

  if (!bytes) {
    return { ok: false, message: "The file is not in storage — try uploading it again." };
  }

  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    await discard(input.pathname);
    return { ok: false, message: "The file is larger than 20 MB." };
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
      message: `Already uploaded as "${duplicate.filename}" — the contents are byte for byte identical.`,
    };
  }

  const parsed = await parseSpreadsheet(bytes, input.filename);

  if (!parsed.ok) {
    log.warn("upload.unreadable", {
      tenantId: user.tenantId,
      userId: user.id,
      code: parsed.code,
      sha256,
    });
    await discard(input.pathname);

    return { ok: false, message: parsed.message };
  }

  const classification = classify(parsed.grid, input.filename);

  if (!classification.ok) {
    log.warn("upload.unclassified", {
      tenantId: user.tenantId,
      userId: user.id,
      code: classification.code,
      dataset: classification.dataset,
      sha256,
    });
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

  // Parsed in the same call rather than by a background job: the operator is
  // waiting on the answer, and a file that classified but never became
  // transactions is the kind of half-state that goes unnoticed for a month.
  //
  // If it fails, the record goes with it. Leaving the row behind would be
  // worse than useless: its checksum makes the file a duplicate, so the same
  // file could never be uploaded again, and the row would sit there for ever
  // holding no transactions.
  let ingested;

  try {
    ingested = await ingestSourceFile(row.id, user.tenantId, parsed.grid);
  } catch (error) {
    log.error("upload.ingest_failed", error, {
      tenantId: user.tenantId,
      userId: user.id,
      entityId: row.id,
      dataset: classification.dataset,
      period: classification.period.label,
    });

    await db.delete(schema.sourceFiles).where(eq(schema.sourceFiles.id, row.id));
    await discard(input.pathname);

    return {
      ok: false,
      message: `Recognised as ${classification.label}, but its rows could not be stored: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  }

  log.info("upload.registered", {
    tenantId: user.tenantId,
    userId: user.id,
    entityId: row.id,
    dataset: classification.dataset,
    period: classification.period.label,
    transactions: ingested.inserted,
    supersededRows: ingested.supersededRows,
    needsAttention: ingested.needsAttention,
  });

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    {
      action: "upload.registered",
      entity: "source_file",
      entityId: row.id,
      payload: {
        filename: input.filename,
        dataset: classification.label,
        period: classification.period.label,
        transactions: ingested.inserted,
        supersededRows: ingested.supersededRows,
      },
    },
  );

  await db
    .update(schema.sourceFiles)
    .set({
      detectionMeta: {
        format: parsed.format,
        encoding: parsed.encoding,
        delimiter: parsed.delimiter,
        marketplace: classification.marketplace,
        periodSource: classification.periodSource,
        rowCount: parsed.grid.length,
        // The two numbers the reconciliation view compares.
        sourceRows: ingested.sourceRows,
        mappedRows: ingested.inserted,
      },
    })
    .where(eq(schema.sourceFiles.id, row.id));

  revalidatePath("/uploads");
  revalidatePath("/transactions");

  return {
    ok: true,
    id: row.id,
    label: classification.label,
    period: classification.period.label,
    transactions: ingested.inserted,
    supersededRows: ingested.supersededRows,
    needsAttention: ingested.needsAttention,
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
