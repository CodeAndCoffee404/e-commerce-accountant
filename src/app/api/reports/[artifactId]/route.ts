import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getDb, schema } from "@/lib/db";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Streams a report file to the browser.
 *
 * A route rather than a Server Action returning a data URL: the largest report
 * is several megabytes, and base64 in a response body means the whole file is
 * held in memory twice and grows by a third on the way. This hands the browser
 * a normal download, with its own progress and its own resume.
 *
 * The store is private, so there is no link to give out — the bytes come
 * through here, behind the same session check as every page.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user?.id || !session.tenantId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { artifactId } = await params;

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
        eq(schema.reportRuns.tenantId, session.tenantId),
      ),
    )
    .limit(1);

  if (!artifact?.blobKey) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const stored = await get(artifact.blobKey, { access: "private" }).catch(() => null);

  if (!stored?.stream) {
    return NextResponse.json({ error: "The file is not available in storage." }, { status: 502 });
  }

  return new NextResponse(stored.stream, {
    headers: {
      "content-type": XLSX_MIME,
      // Quoted and escaped: report names carry spaces and dashes.
      "content-disposition": `attachment; filename="${artifact.filename.replace(/"/g, "")}"`,
      "cache-control": "private, no-store",
    },
  });
}
