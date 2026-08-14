"use client";

import { InboxOutlined } from "@ant-design/icons";
import { upload } from "@vercel/blob/client";
import { App, Upload, type UploadProps } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { MAX_UPLOAD_BYTES, UPLOAD_ACCEPT } from "@/lib/uploads/constants";
import { registerUpload } from "@/lib/uploads/register";

export function UploadDropzone() {
  const router = useRouter();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  const customRequest: UploadProps["customRequest"] = async (options) => {
    const file = options.file as File;

    if (file.size > MAX_UPLOAD_BYTES) {
      const failure = new Error("Файл больше 20 МБ.");

      message.error(failure.message);
      options.onError?.(failure);
      return;
    }

    setBusy(true);

    try {
      // Straight to Blob storage. A Server Action would cap the file at the
      // 4.5 MB request body limit of Vercel functions.
      const blob = await upload(`uploads/${file.name}`, file, {
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

      message.success(`${file.name}: ${result.label}, ${result.period}`);
      options.onSuccess?.(result);
      router.refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Не удалось загрузить файл.";

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
        CSV and XLSX, up to 20 MB. The type, country and period are detected from the file itself.
      </p>
    </Upload.Dragger>
  );
}
