"use client";

import { DeleteOutlined, DownloadOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";

import { KindIcon } from "@/components/common/kind-icon";
import { formatSize } from "@/lib/format";
import { periodLabelWords } from "@/lib/ingest/period";
import { DATASET_NAMES } from "@/modules/channels/registry";
import type { UploadOptions, UploadRow } from "@/lib/uploads/queries";
import type { FileReconciliation } from "@/lib/uploads/reconciliation";

import { deleteUpload } from "@/lib/uploads/delete";

import { PeriodFilterPicker } from "./period-filter-picker";
import { PreviewDrawer } from "./preview-drawer";
import { ReconciliationPanel } from "./reconciliation-panel";

const STATUS_COLOURS: Record<string, string> = {
  received: "default",
  classified: "blue",
  parsed: "green",
  superseded: "orange",
  rejected: "red",
};

/**
 * Display labels only — the stored status (`received`, `classified`, …)
 * never changes, so filtering and the database stay exactly as they were.
 */
/**
 * A channel's name as it is called today.
 *
 * Uploads store the name they were given at the time, so a channel that is
 * renamed leaves old rows reading the old name — and the filter, which offers
 * the stored enum value, would show something different again. Both now come
 * from the one place the rest of the application reads.
 */
function datasetName(dataset: string): string {
  return DATASET_NAMES[dataset as keyof typeof DATASET_NAMES] ?? dataset;
}

const STATUS_LABELS: Record<string, string> = {
  received: "Processing",
  classified: "Classified",
  parsed: "Processed",
  superseded: "Replaced",
  rejected: "Rejected",
};

export function UploadsTable({
  rows,
  options,
  reconciliation,
  canDelete,
  uploadAction,
}: {
  rows: UploadRow[];
  options: UploadOptions;
  reconciliation: Record<string, FileReconciliation>;
  canDelete: boolean;
  /** The Upload files control, provided by the page so roles stay server-side. */
  uploadAction?: ReactNode;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [previewing, setPreviewing] = useState<UploadRow | null>(null);

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());

    if (value === null || value === "") next.delete(key);
    else next.set(key, value);

    startTransition(() => router.push(`/source-files?${next.toString()}`));
  };

  const selector = (
    key: string,
    placeholder: string,
    values: string[],
    labelFor: (value: string) => string = (value) => value,
    width = 180,
  ) => (
    <Select
      allowClear
      showSearch
      style={{ width, flex: "none" }}
      placeholder={placeholder}
      value={params.get(key) ?? undefined}
      onChange={(value) => update(key, value ?? null)}
      options={values.map((value) => ({ value, label: labelFor(value) }))}
      // The field itself stays a fixed width so it doesn't blow out the
      // filter row, but the open dropdown is free to size to its longest
      // option instead of matching that width and clipping it.
      popupMatchSelectWidth={false}
      optionRender={(option) => (
        <Tooltip title={option.data.label} placement="right" mouseEnterDelay={0.4}>
          <span>{option.data.label}</span>
        </Tooltip>
      )}
    />
  );

  return (
    <>
      {/* One row: filters scroll horizontally in their own lane when they
          don't fit, but Upload files is the thing you came to press and
          never scrolls out of view with them. */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", overflowX: "auto", flex: 1, minWidth: 0, padding: "2px 2px" }}>
          <Input.Search
            allowClear
            placeholder="Filename"
            defaultValue={params.get("q") ?? ""}
            style={{ width: 220, flex: "none" }}
            onSearch={(value) => update("q", value || null)}
          />
          {selector("dataset", "Type", options.datasets, datasetName, 340)}
          <PeriodFilterPicker
            value={params.get("period")}
            options={options.periods}
            onChange={(value) => update("period", value)}
          />
          {selector("status", "Status", options.statuses, (value) => STATUS_LABELS[value] ?? value)}
        </div>
        {uploadAction ? <div style={{ flex: "none" }}>{uploadAction}</div> : null}
      </div>

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
        rowClassName={(row) => (row.status === "superseded" ? "ea-superseded" : "")}
        expandable={{
          // The reconciliation lives under the file it is about: "did all of
          // this get in" is a question about one source file, not about a list.
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
        scroll={{ x: 1220 }}
        columns={[
          {
            title: "File",
            dataIndex: "filename",
            // A width, or the column takes whatever the fixed ones leave — on
            // a phone that was four characters, and filenames wrapped letter
            // by letter.
            width: 280,
            render: (filename: string, row) => (
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <KindIcon kind="upload" />
                <div style={{ minWidth: 0 }}>
                  <Typography.Text ellipsis={{ tooltip: filename }} style={{ maxWidth: 214 }}>
                    {filename}
                  </Typography.Text>
                  <br />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatSize(row.sizeBytes)}
                    {row.format ? ` · ${row.format.toUpperCase()}` : ""}
                    {row.rowCount ? ` · ${row.rowCount} rows` : ""}
                  </Typography.Text>
                </div>
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
            width: 180,
            // The channel's current name, not the one stored on the row: the
            // label was written when the file was uploaded, so a channel that
            // has since been renamed would keep its old name here for ever,
            // and the filter above would offer a name the table never shows.
            render: (label: string | null, row) =>
              (row.dataset ? datasetName(row.dataset) : null) ??
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
            // By the period's own start date, not the label text — '2026.Q3'
            // and '2026.10 October' would otherwise interleave by alphabet
            // instead of by when they actually fall.
            sorter: (a, b) => (a.periodStart ?? "").localeCompare(b.periodStart ?? ""),
            // Read as words — "August 2026", "Q3 2026" — so the cell matches
            // what the filter button above it says. The stored label keeps its
            // own shape; only the reading changes.
            render: (period: string | null) => (
              <Typography.Text>{period ? periodLabelWords(period) : "—"}</Typography.Text>
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
                  <Tag color={STATUS_COLOURS[status] ?? "default"}>
                    {STATUS_LABELS[status] ?? status}
                  </Tag>
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
            key: "actions",
            width: 190,
            render: (_, row) => (
              <Space size={4}>
                <Button size="small" onClick={() => setPreviewing(row)}>
                  Preview
                </Button>
                <Tooltip title="Download the original file, exactly as uploaded.">
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    href={`/api/uploads/${row.id}`}
                    download={row.filename}
                    aria-label="Download"
                  />
                </Tooltip>

                {canDelete ? (
                  <Popconfirm
                    title="Delete this source file?"
                    description={
                      <div style={{ maxWidth: 320 }}>
                        The file, its rows and its stored copy all go. If it replaced an
                        earlier file for this period, that earlier one counts again. A file a
                        report was built from cannot be deleted until that report is.
                      </div>
                    }
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    cancelText="Keep"
                    onConfirm={() =>
                      startTransition(async () => {
                        try {
                          const result = await deleteUpload(row.id);

                          // Ten seconds on a refusal: it names the reports
                          // that have to go first — not readable in three.
                          if (result.ok) message.success(result.message, 6);
                          else message.error(result.message, 10);
                        } catch {
                          message.error("The server could not be reached — nothing was changed. Check the connection and try again.", 8);
                        }

                        router.refresh();
                      })
                    }
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} aria-label="Delete" />
                  </Popconfirm>
                ) : null}
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}
