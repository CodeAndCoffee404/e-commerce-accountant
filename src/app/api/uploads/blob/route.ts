import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { MAX_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES } from "@/lib/uploads/constants";

/**
 * Presigns a URL so the browser uploads straight to Blob storage.
 *
 * Routing the file through a Server Action instead would cap it at the 4.5 MB
 * request body limit of Vercel functions, and the client's exports run larger.
 *
 * Presigned rather than the older client-token flow, which needs a static
 * BLOB_READ_WRITE_TOKEN. Vercel no longer issues one for a project that
 * authenticates by OIDC, and the presigned path works from the OIDC identity
 * the deployment already has — so there is no long-lived storage credential to
 * keep anywhere.
 */
export async function POST(request: Request): Promise<NextResponse> {
  // Checked before the handler: it validates store credentials first, so a
  // misconfigured store would answer an anonymous caller with a configuration
  // error instead of a refusal.
  const session = await auth();

  if (!session?.user?.id || !session.tenantId) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const body = (await request.json()) as HandleUploadPresignedBody;

  try {
    const result = await handleUploadPresigned({
      request,
      body,
      getSignedToken: async (pathname) => ({
        token: await issueSignedToken({
          pathname,
          operations: ["put"],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          allowedContentTypes: [...UPLOAD_CONTENT_TYPES],
          // Ten minutes is plenty for a 20 MB upload and keeps a leaked URL
          // from being useful for long.
          validUntil: Date.now() + 10 * 60 * 1000,
        }),
      }),
      // No onUploadCompleted: the callback cannot reach localhost, so the file
      // is registered by an explicit call from the client once upload resolves.
      // See registerUpload in src/lib/uploads/register.ts.
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
