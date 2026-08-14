"use client";

import { Card, Empty, Table, Tag, Typography } from "antd";

import type { AuditRow } from "@/lib/audit/record";

/** Colour by what the action does, not by which table it touched. */
function tone(action: string): string {
  if (action.endsWith(".deleted") || action.endsWith(".suspended")) return "red";
  if (action.endsWith(".failed")) return "volcano";
  if (action.startsWith("report.")) return "blue";
  if (action.startsWith("upload.")) return "geekblue";
  if (action.startsWith("member.") || action.startsWith("drive.")) return "purple";

  return "default";
}

function summarise(payload: Record<string, unknown> | null): string {
  if (!payload) return "";

  return Object.entries(payload)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`)
    .join(" · ");
}

export function AuditCard({ rows }: { rows: AuditRow[] }) {
  return (
    <Card size="small" title="Activity">
      <Typography.Paragraph type="secondary">
        Who did what. The reference tables keep no history of their own, so this is where
        &ldquo;who changed this rate, and when&rdquo; is answered. Entries are never edited or
        removed.
      </Typography.Paragraph>

      <Table<AuditRow>
        dataSource={rows}
        rowKey="id"
        size="small"
        pagination={rows.length > 25 ? { pageSize: 25, showSizeChanger: false } : false}
        locale={{ emptyText: <Empty description="Nothing has happened yet" /> }}
        columns={[
          {
            title: "When",
            dataIndex: "createdAt",
            width: 175,
            render: (value: Date) => new Date(value).toLocaleString("en-GB"),
          },
          {
            title: "Who",
            dataIndex: "userEmail",
            width: 220,
            ellipsis: true,
            render: (value: string | null) => value ?? <Typography.Text type="secondary">—</Typography.Text>,
          },
          {
            title: "Action",
            dataIndex: "action",
            width: 190,
            render: (action: string) => <Tag color={tone(action)}>{action}</Tag>,
          },
          {
            title: "Details",
            dataIndex: "payload",
            ellipsis: true,
            render: (payload: Record<string, unknown> | null) => (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {summarise(payload)}
              </Typography.Text>
            ),
          },
        ]}
      />
    </Card>
  );
}
