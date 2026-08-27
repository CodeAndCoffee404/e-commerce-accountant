import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getDb, schema } from "@/lib/db";

const DEFAULT_MIME = "application/octet-stream";

/**
 * Streams the original uploaded file back to the browser, byte for byte —
 * the same file `previewUpload` reads from, never a reprocessed copy: there
 * isn't one. The store is private, so there is no link to give out; the
 * bytes come through here, behind the same session check as every page.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user?.id || !session.tenantId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { fileId } = await params;

  const [file] = await getDb()
    .select({
      filename: schema.sourceFiles.originalFilename,
      mimeType: schema.sourceFiles.mimeType,
      blobKey: schema.sourceFiles.blobKey,
    })
    .from(schema.sourceFiles)
    .where(
      // Scoped by tenant: a file id alone must not reach another tenant's
      // upload.
      and(eq(schema.sourceFiles.id, fileId), eq(schema.sourceFiles.tenantId, session.tenantId)),
    )
    .limit(1);

  if (!file) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const stored = await get(file.blobKey, { access: "private" }).catch(() => null);

  if (!stored?.stream) {
    return NextResponse.json({ error: "The file is not available in storage." }, { status: 502 });
  }

  return new NextResponse(stored.stream, {
    headers: {
      "content-type": file.mimeType ?? DEFAULT_MIME,
      // Quoted and escaped: filenames carry spaces and dashes.
      "content-disposition": `attachment; filename="${file.filename.replace(/"/g, "")}"`,
      "cache-control": "private, no-store",
    },
  });
}
