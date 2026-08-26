"use client";

import { Card, Space, Tag, Typography } from "antd";

import { describePeriodLabel, monthLabelWords } from "@/lib/ingest/period";
import type { DeadlineDashboardRow } from "@/lib/reports/deadlines-queries";

const { Text } = Typography;

/**
 * The sidebar of what's due for the month shown on the dashboard: a compact
 * list rather than a table, since it sits next to the Hero rather than
 * spanning the page.
 *
 * Sorted server-side (overdue, worst first; due today; upcoming, soonest
 * first; completed, latest deadline first) — this component only renders the
 * order it was handed.
 */
export function ReportDeadlinesBlock({
  rows,
  month,
}: {
  rows: DeadlineDashboardRow[];
  month: string | null;
}) {
  return (
    <Card
      size="small"
      title="Report deadlines"
      className="ea-rise"
      // Matches the Hero's own height rather than growing past it: the row
      // already stretches both cards to the taller one's height (see
      // DashboardView's alignItems: "stretch"), so without this a long list
      // of deadlines used to drag the Hero down into empty space beneath its
      // own content just to stay level with it. Flex column here, with the
      // body below made scrollable, lets this card conform to the Hero
      // instead of the other way around.
      style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}
      styles={{ body: { flex: "1 1 auto", minHeight: 0, overflowY: "auto" } }}
      extra={
        month ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {monthLabelWords(month)}
          </Text>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {month ? `Nothing due for ${monthLabelWords(month)}.` : "No month selected yet."}
        </Text>
      ) : (
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          {rows.map((row) => (
            <div key={row.key} style={{ minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <Text strong style={{ fontSize: 12.5 }} ellipsis>
                  {row.label}
                </Text>
                <StatusTag state={row.state} />
              </div>
              <Text type="secondary" style={{ fontSize: 11.5 }}>
                {/* Named plainly — "(month)" / "(quarter)" / "(year)" — so a
                    monthly and a quarterly deadline never look alike at a
                    glance, the way `2026.07 July` and `2026.Q3` can. */}
                {describePeriodLabel(row.periodLabel, row.granularity)} · due{" "}
                {formatDeadline(row.deadline)}
              </Text>
            </div>
          ))}
        </Space>
      )}
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
  const style = { margin: 0, fontSize: 11, lineHeight: "16px", padding: "0 6px" };

  switch (state.kind) {
    case "completed":
      return (
        <Tag color="success" style={style}>
          Completed
        </Tag>
      );
    case "overdue":
      return (
        <Tag color="error" style={style}>
          Overdue {state.days}d
        </Tag>
      );
    case "due_today":
      return (
        <Tag color="warning" style={style}>
          Due today
        </Tag>
      );
    case "due_tomorrow":
      return (
        <Tag color="warning" style={style}>
          Due tomorrow
        </Tag>
      );
    case "due_in":
      return (
        <Tag color={state.days <= 3 ? "warning" : "default"} style={style}>
          Due in {state.days}d
        </Tag>
      );
  }
}
