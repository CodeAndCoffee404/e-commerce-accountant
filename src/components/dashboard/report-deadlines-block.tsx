"use client";

import { Card, Table, Tag, Typography } from "antd";

import type { DeadlineDashboardRow } from "@/lib/reports/deadlines-queries";

const { Text } = Typography;

/**
 * The top-of-dashboard strip of what is due, when, and where it stands.
 *
 * Sorted server-side (overdue, worst first; due today; upcoming, soonest
 * first; completed, latest deadline first) — this component only renders the
 * order it was handed.
 */
export function ReportDeadlinesBlock({ rows }: { rows: DeadlineDashboardRow[] }) {
  if (rows.length === 0) return null;

  return (
    <Card size="small" title="Report deadlines" className="ea-rise">
      <Table<DeadlineDashboardRow>
        dataSource={rows}
        rowKey="key"
        size="small"
        pagination={false}
        columns={[
          {
            title: "Report",
            dataIndex: "label",
            render: (label: string) => <Text strong>{label}</Text>,
          },
          { title: "Period", dataIndex: "periodLabel" },
          {
            title: "Deadline",
            dataIndex: "deadline",
            render: (deadline: string) => formatDeadline(deadline),
          },
          {
            title: "Status",
            dataIndex: "state",
            render: (_: unknown, row) => <StatusTag state={row.state} />,
          },
        ]}
      />
    </Card>
  );
}

function formatDeadline(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function StatusTag({ state }: { state: DeadlineDashboardRow["state"] }) {
  switch (state.kind) {
    case "completed":
      return <Tag color="success">Completed</Tag>;
    case "overdue":
      return (
        <Tag color="error">
          Overdue by {state.days} day{state.days === 1 ? "" : "s"}
        </Tag>
      );
    case "due_today":
      return <Tag color="warning">Due today</Tag>;
    case "due_tomorrow":
      return <Tag color="warning">Due tomorrow</Tag>;
    case "due_in":
      return (
        <Tag color={state.days <= 3 ? "warning" : "default"}>
          Due in {state.days} day{state.days === 1 ? "" : "s"}
        </Tag>
      );
  }
}
