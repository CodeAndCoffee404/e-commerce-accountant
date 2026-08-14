"use client";

import { InboxOutlined } from "@ant-design/icons";
import { uploadPresigned } from "@vercel/blob/client";
import { App, Upload, type UploadProps } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { MAX_UPLOAD_BYTES, UPLOAD_ACCEPT } from "@/lib/uploads/constants";
import { uploadPath } from "@/lib/uploads/paths";
import { registerUpload } from "@/lib/uploads/register";

export function UploadDropzone({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  const customRequest: UploadProps["customRequest"] = async (options) => {
    const file = options.file as File;

    if (file.size > MAX_UPLOAD_BYTES) {
      const failure = new Error("The file is larger than 20 MB.");

      message.error(failure.message);
      options.onError?.(failure);
      return;
    }

    setBusy(true);

    try {
      // Straight to Blob storage over a presigned URL. A Server Action would
      // cap the file at the 4.5 MB request body limit of Vercel functions.
      // Scoped to the tenant and unique per upload: the server refuses to sign
      // anything else, and reusing a key would leave an earlier record pointing
      // at another file's bytes.
      const blob = await uploadPresigned(uploadPath(tenantId, file.name, crypto.randomUUID()), file, {
        access: "private",
        handleUploadUrl: "/api/uploads/blob",
        contentType: file.type || undefined,
      });

      const result = await registerUpload({
        pathname: blob.pathname,
        url: blob.url,
        filename: file.name,
        contentType: file.type || undefined,
      });

      if (!result.ok) {
        message.error(result.message, 8);
        options.onError?.(new Error(result.message));
        return;
      }

      const parts = [`${result.label}, ${result.period}`, `${result.transactions} rows`];

      if (result.supersededRows > 0) parts.push(`replaced ${result.supersededRows}`);
      if (result.needsAttention > 0) parts.push(`${result.needsAttention} need attention`);

      message.success(`${file.name}: ${parts.join(" · ")}`, 6);
      options.onSuccess?.(result);
      router.refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "The file could not be uploaded.";

      message.error(text, 8);
      options.onError?.(error as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Upload.Dragger
      name="file"
      multiple
      accept={UPLOAD_ACCEPT}
      customRequest={customRequest}
      disabled={busy}
      showUploadList={false}
      style={{ marginBottom: 24 }}
    >
      <p className="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p className="ant-upload-text">Drop channel exports here, or click to choose</p>
      <p className="ant-upload-hint">
        CSV and XLSX, up to 20 MB. Upload the file exactly as the channel exported it — the
        type, country and period are read from its contents, not from its name.
      </p>
      <p className="ant-upload-hint">
        Re-uploading a corrected file for a period you already have replaces it. The old rows
        are kept but stop counting, so reports stay traceable.
      </p>
    </Upload.Dragger>
  );
}
