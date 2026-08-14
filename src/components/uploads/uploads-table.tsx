"use client";

import { Button, Empty, Table, Tag, Typography } from "antd";
import { useState } from "react";

import type { UploadRow } from "@/lib/uploads/queries";

import { PreviewDrawer } from "./preview-drawer";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_COLOURS: Record<string, string> = {
  received: "default",
  classified: "blue",
  parsed: "green",
  superseded: "orange",
  rejected: "red",
};

export function UploadsTable({ rows }: { rows: UploadRow[] }) {
  const [previewing, setPreviewing] = useState<UploadRow | null>(null);

  return (
    <>
      <PreviewDrawer
        fileId={previewing?.id ?? null}
        filename={previewing?.filename ?? null}
        onClose={() => setPreviewing(null)}
      />

      <Table<UploadRow>
        dataSource={rows}
        rowKey="id"
        size="middle"
        pagination={
          rows.length > 20 ? { pageSize: 20, showSizeChanger: false } : false
        }
        locale={{ emptyText: <Empty description="No files uploaded yet" /> }}
        scroll={{ x: 900 }}
        columns={[
          {
            title: "File",
            dataIndex: "filename",
            render: (filename: string, row) => (
              <div>
                <Typography.Text>{filename}</Typography.Text>
                <br />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {formatSize(row.sizeBytes)}
                  {row.format ? ` · ${row.format.toUpperCase()}` : ""}
                  {row.rowCount ? ` · ${row.rowCount} rows` : ""}
                </Typography.Text>
              </div>
            ),
          },
          {
            title: "Detected type",
            dataIndex: "label",
            render: (label: string | null) =>
              label ?? <Typography.Text type="secondary">—</Typography.Text>,
          },
          {
            title: "Country",
            dataIndex: "country",
            width: 100,
            render: (country: string | null) =>
              country ? <Tag>{country}</Tag> : "—",
          },
          {
            title: "Period",
            dataIndex: "period",
            width: 170,
            render: (period: string | null, row) => (
              <div>
                <Typography.Text>{period ?? "—"}</Typography.Text>
                {/* Where the period came from matters: a filename can be renamed,
                  the data cannot. */}
                {row.periodSource === "filename" ? (
                  <>
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      from filename
                    </Typography.Text>
                  </>
                ) : null}
              </div>
            ),
          },
          {
            title: "Status",
            dataIndex: "status",
            width: 120,
            render: (status: string) => (
              <Tag color={STATUS_COLOURS[status] ?? "default"}>{status}</Tag>
            ),
          },
          {
            title: "Uploaded",
            dataIndex: "uploadedAt",
            width: 180,
            render: (value: Date) => new Date(value).toLocaleString("en-GB"),
          },
          {
            title: "",
            key: "preview",
            width: 90,
            render: (_, row) => (
              <Button size="small" onClick={() => setPreviewing(row)}>
                Preview
              </Button>
            ),
          },
        ]}
      />
    </>
  );
}
