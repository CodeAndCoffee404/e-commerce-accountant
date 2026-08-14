"use client";

import { Button, Empty, Input, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import type { UploadOptions, UploadRow } from "@/lib/uploads/queries";
import type { FileReconciliation } from "@/lib/uploads/reconciliation";

import { PreviewDrawer } from "./preview-drawer";
import { ReconciliationPanel } from "./reconciliation-panel";

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

export function UploadsTable({
  rows,
  options,
  reconciliation,
}: {
  rows: UploadRow[];
  options: UploadOptions;
  reconciliation: Record<string, FileReconciliation>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [previewing, setPreviewing] = useState<UploadRow | null>(null);

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());

    if (value === null || value === "") next.delete(key);
    else next.set(key, value);

    startTransition(() => router.push(`/uploads?${next.toString()}`));
  };

  const selector = (key: string, placeholder: string, values: string[]) => (
    <Select
      allowClear
      showSearch
      style={{ minWidth: 180 }}
      placeholder={placeholder}
      value={params.get(key) ?? undefined}
      onChange={(value) => update(key, value ?? null)}
      options={values.map((value) => ({ value, label: value }))}
    />
  );

  return (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder="Filename"
          defaultValue={params.get("q") ?? ""}
          style={{ width: 220 }}
          onSearch={(value) => update("q", value || null)}
        />
        {selector("dataset", "Type", options.datasets)}
        {selector("period", "Period", options.periods)}
        {selector("status", "Status", options.statuses)}
      </Space>

      <PreviewDrawer
        fileId={previewing?.id ?? null}
        filename={previewing?.filename ?? null}
        onClose={() => setPreviewing(null)}
      />

      <Table<UploadRow>
        dataSource={rows}
        rowKey="id"
        size="middle"
        loading={pending}
        expandable={{
          // The reconciliation lives under the file it is about: "did all of
          // this get in" is a question about one upload, not about a list.
          expandedRowRender: (row) => (
            <ReconciliationPanel fileId={row.id} data={reconciliation[row.id]} />
          ),
        }}
        pagination={
          rows.length > 20 ? { pageSize: 20, showSizeChanger: false } : false
        }
        locale={{
        emptyText: (
          <Empty
            description={
              <span>
                No files yet.
                <br />
                Use <b>Upload files</b> above — Amazon, Allegro, Cdiscount or Shopify exports.
              </span>
            }
          />
        ),
      }}
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
            title: (
              <Tooltip title="Matched on the required headers inside the file. The filename is never used to decide the type.">
                Detected type
              </Tooltip>
            ),
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
            title: (
              <Tooltip title="A file covers one month or one whole quarter. Reports select by this period, so it decides which report a file feeds.">
                Period
              </Tooltip>
            ),
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
            width: 150,
            render: (status: string, row) => {
              const flagged = reconciliation[row.id]?.needsAttention ?? 0;

              return (
                <Space direction="vertical" size={4}>
                  <Tag color={STATUS_COLOURS[status] ?? "default"}>{status}</Tag>
                  {flagged > 0 ? (
                    <Tooltip title="Rows whose number or date could not be read. Expand this row for the detail.">
                      <Tag color="orange">{flagged} to review</Tag>
                    </Tooltip>
                  ) : null}
                </Space>
              );
            },
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
              <Tooltip title="Show the first rows of the stored file, read on demand.">
                <Button size="small" onClick={() => setPreviewing(row)}>
                  Preview
                </Button>
              </Tooltip>
            ),
          },
        ]}
      />
    </>
  );
}
