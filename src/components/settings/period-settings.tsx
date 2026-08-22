"use client";

import { Alert, Card, Select, Space, Switch, Typography } from "antd";

import { MONTHS } from "@/lib/ingest/months";
import { savePeriodSchedule, type PeriodActionResult } from "@/lib/periods/actions";
import type { PeriodSchedule } from "@/lib/periods/schedule";

type Runner = (action: () => Promise<PeriodActionResult>) => void;

const ROWS: {
  key: "month" | "quarter" | "year";
  label: string;
  detail: string;
}[] = [
  {
    key: "month",
    label: "Monthly",
    detail: "One period per calendar month, opened on the first.",
  },
  {
    key: "quarter",
    label: "Quarterly",
    detail:
      "Calendar quarters, assembled from the months inside them. A channel that sends a whole quarter in one export is counted once, not alongside its months.",
  },
  {
    key: "year",
    label: "Yearly",
    detail: "One period per financial year, assembled from its months the same way.",
  },
];

/**
 * When periods come into being.
 *
 * A period exists before anything is uploaded into it: on the first of the
 * month the month opens, and its checklist is visible and empty rather than
 * absent. This is where the client says which of them they actually file.
 */
export function PeriodSettingsTab({
  schedule,
  canEdit,
  run,
  pending,
}: {
  schedule: PeriodSchedule;
  canEdit: boolean;
  run: Runner;
  pending: boolean;
}) {
  const save = (next: Partial<PeriodSchedule>) => {
    run(() => savePeriodSchedule({ ...schedule, ...next }));
  };

  const only = ROWS.filter((row) => schedule[row.key]);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Turning one on starts from the period being lived through — switch quarterly filing on in
        the middle of a quarter and that quarter appears, because it is the one being worked on.
        It never reaches back over the ones before it. A file for a period that was never opened
        opens it anyway: an export arriving late is never refused.
      </Typography.Paragraph>

      <Card size="small" title="Periods opened">
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          {ROWS.map((row) => (
            <Space key={row.key} align="start" size={12} style={{ width: "100%" }}>
              <Switch
                checked={schedule[row.key]}
                // The last one on cannot be switched off: with none, nothing
                // would ever appear to file.
                disabled={!canEdit || pending || (schedule[row.key] && only.length === 1)}
                aria-label={`${row.label} periods on or off`}
                onChange={(checked) => save({ [row.key]: checked })}
              />
              <div>
                <Typography.Text strong>{row.label}</Typography.Text>
                <br />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {row.detail}
                </Typography.Text>
              </div>
            </Space>
          ))}
        </Space>
      </Card>

      <Card size="small" title="Financial year begins">
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Select
            value={schedule.fiscalYearStartMonth}
            disabled={!canEdit || pending || !schedule.year}
            style={{ width: 200 }}
            aria-label="Month the financial year begins"
            options={MONTHS.map((month) => ({ value: month.number, label: month.fullName }))}
            onChange={(fiscalYearStartMonth) => save({ fiscalYearStartMonth })}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Moves the yearly period only. Quarters stay calendar quarters, because a file&apos;s
            own quarter is read out of its contents and has to keep meaning what it has always
            meant. A year beginning in April runs to the following March and is named for the year
            it starts in.
          </Typography.Text>
        </Space>
      </Card>

      {schedule.year ? null : (
        <Alert
          type="info"
          showIcon
          message="Yearly periods are off"
          description="Nothing is lost by leaving them off — the year can be turned on later and will start from the year being lived through. Reports are offered per year only where the report itself is prepared for one, which is set under Settings → Reports."
        />
      )}
    </Space>
  );
}
