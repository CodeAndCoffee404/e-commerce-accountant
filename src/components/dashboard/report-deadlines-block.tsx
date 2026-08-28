"use client";

import { Card, Space, theme, Typography } from "antd";

import { KindIcon } from "@/components/common/kind-icon";
import { describePeriodLabel, monthLabelWords } from "@/lib/ingest/period";
import type { DeadlineDashboardRow } from "@/lib/reports/deadlines-queries";

import { staleStyle } from "./stale-style";

const { Text } = Typography;

/**
 * Three rows, plus a sliver of the fourth as the cue that there is more to
 * scroll to. A row is two lines of text (~36px) with a 10px gap between rows.
 */
const VISIBLE_ROWS_MAX_HEIGHT = 3 * 36 + 2 * 10 + 12;

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
  switching,
}: {
  rows: DeadlineDashboardRow[];
  month: string | null;
  /**
   * A month switch is in flight: `rows` is still last month's list until the
   * new page commits, so it dims like every other stale block rather than
   * sitting under the already-updated month caption with no cue that it
   * hasn't caught up yet.
   */
  switching: boolean;
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
      <div style={staleStyle(switching)}>
        {rows.length === 0 ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {month ? `Nothing due for ${monthLabelWords(month)}.` : "No month selected yet."}
          </Text>
        ) : (
          // Capped at three visible rows whatever the Hero's height gives the
          // card — the rest are a scroll away rather than a longer page.
          <div style={{ maxHeight: VISIBLE_ROWS_MAX_HEIGHT, overflowY: "auto" }}>
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              {rows.map((row) => (
                <div key={row.key} style={{ display: "flex", gap: 8, minWidth: 0 }}>
                  <KindIcon kind="report" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <Text strong style={{ fontSize: 12.5 }} ellipsis>
                        {row.label}
                      </Text>
                      <StatusLabel state={row.state} />
                    </div>
                    <Text type="secondary" style={{ fontSize: 11.5 }}>
                      {/* The period is named only when it is not the month the
                          card's own header already names. At a month end a
                          quarterly deadline stands beside the monthly ones and
                          is otherwise indistinguishable from them; the rest of
                          the time repeating "July 2026" under a card headed
                          "July 2026" says nothing. */}
                      {row.periodLabel === month
                        ? null
                        : `${describePeriodLabel(row.periodLabel, row.granularity)} · `}
                      due {formatDeadline(row.deadline)}
                    </Text>
                  </div>
                </div>
              ))}
            </Space>
          </div>
        )}
      </div>
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

/**
 * The state written the way a report's state is written on the dashboard: a
 * coloured dot and a short word, so a deadline and the report it belongs to
 * read as the same kind of thing rather than as a tag next to a status.
 */
function StatusLabel({ state }: { state: DeadlineDashboardRow["state"] }) {
  const { token } = theme.useToken();

  const shown =
    state.kind === "completed"
      ? { color: token.colorSuccess, text: "Done" }
      : state.kind === "overdue"
        ? { color: token.colorError, text: `${state.days}d late` }
        : state.kind === "due_today"
          ? { color: token.colorWarning, text: "Due today" }
          : state.kind === "due_tomorrow"
            ? { color: token.colorWarning, text: "Tomorrow" }
            : {
                color: state.days <= 3 ? token.colorWarning : token.colorTextQuaternary,
                text: `In ${state.days}d`,
              };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flex: "none",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: shown.color,
          flex: "none",
        }}
      />
      <Text style={{ fontSize: 11.5, fontWeight: 500, color: shown.color }}>{shown.text}</Text>
    </span>
  );
}
