import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { MAX_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES } from "@/lib/uploads/constants";

/**
 * Issues a short-lived token so the browser uploads straight to Blob storage.
 *
 * Routing the file through a Server Action instead would cap it at the 4.5 MB
 * request body limit of Vercel functions, and the client's exports run larger.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async () => {
        const session = await auth();

        if (!session?.user?.id || !session.tenantId) {
          throw new Error("Не авторизован");
        }

        return {
          allowedContentTypes: [...UPLOAD_CONTENT_TYPES],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          // Ten minutes is plenty for a 20 MB upload and keeps a leaked token
          // from being useful for long.
          validUntil: Date.now() + 10 * 60 * 1000,
        };
      },
      // No onUploadCompleted: the callback cannot reach localhost, so the file
      // is registered by an explicit call from the client once upload resolves.
      // See registerUpload in src/lib/uploads/register.ts.
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
