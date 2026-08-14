"use server";

import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";

import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { parseSpreadsheet } from "@/lib/ingest/parse";

export type Preview =
  | { ok: true; headers: string[]; rows: string[][]; totalRows: number }
  | { ok: false; message: string };

const PREVIEW_ROWS = 10;
const PREVIEW_COLUMNS = 12;

/**
 * Reads the first rows of a stored file on demand.
 *
 * Deliberately not cached into the database: these rows carry buyer names,
 * addresses and emails, and a second copy of that is a second thing to protect
 * and to erase on request.
 */
export async function previewUpload(fileId: string): Promise<Preview> {
  const user = await requireUser();

  const [file] = await getDb()
    .select({
      blobKey: schema.sourceFiles.blobKey,
      filename: schema.sourceFiles.originalFilename,
      headerRowIndex: schema.sourceFiles.headerRowIndex,
    })
    .from(schema.sourceFiles)
    .where(
      // Scoped by tenant, not just by id: the id alone would let one tenant
      // read another's file by guessing.
      and(eq(schema.sourceFiles.id, fileId), eq(schema.sourceFiles.tenantId, user.tenantId)),
    )
    .limit(1);

  if (!file) return { ok: false, message: "Файл не найден." };

  const result = await get(file.blobKey, { access: "private" }).catch(() => null);

  if (!result?.stream) return { ok: false, message: "Файл недоступен в хранилище." };

  const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
  const parsed = await parseSpreadsheet(bytes, file.filename);

  if (!parsed.ok) return { ok: false, message: parsed.message };

  const headerIndex = file.headerRowIndex ?? 0;
  const headers = [...(parsed.grid[headerIndex] ?? [])].slice(0, PREVIEW_COLUMNS);
  const rows = parsed.grid
    .slice(headerIndex + 1, headerIndex + 1 + PREVIEW_ROWS)
    .map((row) => [...row].slice(0, PREVIEW_COLUMNS));

  return {
    ok: true,
    headers,
    rows,
    totalRows: Math.max(0, parsed.grid.length - headerIndex - 1),
  };
}
