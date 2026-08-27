"use client";

import { DownloadOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Skeleton, Table, Typography } from "antd";
import { useEffect, useState } from "react";

import { previewUpload, type Preview } from "@/lib/uploads/preview";

export function PreviewDrawer({
  fileId,
  filename,
  onClose,
}: {
  fileId: string | null;
  filename: string | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={fileId !== null}
      onClose={onClose}
      title={filename ?? "Preview"}
      width="min(900px, 100%)"
      destroyOnHidden
      extra={
        fileId ? (
          <Button
            size="small"
            icon={<DownloadOutlined />}
            href={`/api/uploads/${fileId}`}
            download={filename ?? undefined}
          >
            Download
          </Button>
        ) : null
      }
    >
      {/* Keyed by file so opening another row remounts and refetches, which
          keeps the loading state out of an effect that would have to clear it. */}
      {fileId ? <PreviewContent key={fileId} fileId={fileId} /> : null}
    </Drawer>
  );
}

function PreviewContent({ fileId }: { fileId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    let active = true;

    previewUpload(fileId).then((result) => {
      // The drawer may already be closed by the time the file comes back.
      if (active) setPreview(result);
    });

    return () => {
      active = false;
    };
  }, [fileId]);

  if (preview === null) return <Skeleton active />;

  if (!preview.ok) return <Alert type="error" showIcon message={preview.message} />;

  return (
    <>
      <Typography.Paragraph type="secondary">
        First {preview.rows.length} of {preview.totalRows} data rows, first {preview.headers.length}{" "}
        columns.
      </Typography.Paragraph>

      <Table
        size="small"
        pagination={false}
        scroll={{ x: "max-content" }}
        rowKey="key"
        dataSource={preview.rows.map((row, index) => ({ key: index, row }))}
        columns={preview.headers.map((header, columnIndex) => ({
          title: header || `#${columnIndex + 1}`,
          key: columnIndex,
          ellipsis: true,
          render: (_: unknown, record: { row: string[] }) => record.row[columnIndex] ?? "",
        }))}
      />
    </>
  );
}
