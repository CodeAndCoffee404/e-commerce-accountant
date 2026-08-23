"use client";

import { Card, InputNumber, Select, Space, Typography } from "antd";

import {
  saveDeadlineRule,
  type DeadlineActionResult,
} from "@/lib/reports/deadlines-actions";
import type { DeadlineRuleRow } from "@/lib/reports/deadlines-queries";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type Runner = (action: () => Promise<DeadlineActionResult>) => void;

/**
 * When each report is due, as a rule rather than a date: monthly and
 * quarterly reports take a day of the following month, yearly reports a
 * month and day of the following year. Every existing period's deadline —
 * past, present, future, already filed — moves the moment this is saved.
 */
export function DeadlineSettingsTab({
  rules,
  canEdit,
  run,
  pending,
}: {
  rules: DeadlineRuleRow[];
  canEdit: boolean;
  run: Runner;
  pending: boolean;
}) {
  const save = (row: DeadlineRuleRow, day: number, month: number | null) => {
    run(() =>
      saveDeadlineRule({ reportType: row.reportType, granularity: row.granularity, day, month }),
    );
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        The day (and, for a yearly report, the month) a report falls due, relative to the period it
        covers. A monthly or quarterly report is due on this day of the month right after the period
        ends; a yearly report is due in the month and day set here, the year after. Editing a rule
        recalculates every period&apos;s deadline the next time it is shown — nothing is stored per
        period.
      </Typography.Paragraph>

      {rules.length === 0 ? (
        <Typography.Text type="secondary">
          No report is currently prepared for any period — enable one under the Reports tab first.
        </Typography.Text>
      ) : (
        rules.map((row) => (
          <Card key={`${row.reportType}:${row.granularity}`} size="small" title={row.label}>
            <Space size={16} wrap align="center">
              <Typography.Text style={{ textTransform: "capitalize" }}>
                {row.granularity}
              </Typography.Text>

              {row.granularity === "year" ? (
                <Space size={8}>
                  <Typography.Text type="secondary">Month</Typography.Text>
                  <Select
                    size="small"
                    disabled={!canEdit || pending}
                    value={row.rule.month ?? 1}
                    style={{ width: 130 }}
                    options={MONTHS.map((name, index) => ({ label: name, value: index + 1 }))}
                    onChange={(month) => save(row, row.rule.day, month)}
                  />
                </Space>
              ) : null}

              <Space size={8}>
                <Typography.Text type="secondary">Day</Typography.Text>
                <InputNumber
                  size="small"
                  min={1}
                  max={31}
                  disabled={!canEdit || pending}
                  value={row.rule.day}
                  onChange={(day) => {
                    if (typeof day === "number") save(row, day, row.rule.month);
                  }}
                />
              </Space>

              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {row.granularity === "year"
                  ? `Due ${MONTHS[(row.rule.month ?? 1) - 1]} ${row.rule.day}, the year after`
                  : `Due the ${ordinal(row.rule.day)} of the month after`}
              </Typography.Text>
            </Space>
          </Card>
        ))
      )}
    </Space>
  );
}

function ordinal(day: number): string {
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";

  return `${day}${suffix}`;
}
