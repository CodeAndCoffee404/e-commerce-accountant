"use client";

import { Alert, App, Button, Space, Typography } from "antd";
import { useState, useTransition } from "react";

import type { EffectiveFromPreview } from "@/lib/reports/effective-from";
import {
  previewEffectiveFrom,
  saveEffectiveFrom,
} from "@/lib/reports/effective-from-actions";
import type { ReportTypeId } from "@/lib/reports/definitions";

/**
 * One report's reporting-start date: a plain date field, a "Check" step that
 * shows exactly what would open and what would stop appearing, and a
 * "Confirm" that only exists once that preview has been seen.
 *
 * Deliberately not wired through the tab's shared `run` — that helper always
 * toasts on success, which is wrong for a preview (nothing happened yet) and
 * would let a click reach the database with no numbers shown first.
 */
export function EffectiveFromControl({
  reportType,
  current,
  canEdit,
}: {
  reportType: ReportTypeId;
  current: string | null;
  canEdit: boolean;
}) {
  const { message } = App.useApp();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(current ?? "");
  const [preview, setPreview] = useState<EffectiveFromPreview | null>(null);

  const dirty = date !== "" && date !== (current ?? "");

  const check = () => {
    setPreview(null);
    startTransition(async () => {
      const result = await previewEffectiveFrom({ reportType, effectiveFrom: date });

      if (!result.ok) {
        message.error(result.message, 6);
        return;
      }

      if (!result.committed) setPreview(result.preview);
    });
  };

  const confirm = () => {
    startTransition(async () => {
      const result = await saveEffectiveFrom({ reportType, effectiveFrom: date });

      if (!result.ok) {
        message.error(result.message, 6);
        return;
      }

      if (result.committed) {
        message.success(result.message);
        setPreview(null);
      }
    });
  };

  return (
    <Space direction="vertical" size={4} style={{ width: "100%" }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Reporting starts from{current ? "" : " (not set — offered since it was turned on)"}:
      </Typography.Text>
      <Space size={8} wrap>
        <input
          type="date"
          disabled={!canEdit || pending}
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            setPreview(null);
          }}
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            border: "1px solid var(--ant-color-border)",
            background: "var(--ant-color-bg-container)",
            color: "inherit",
          }}
        />
        <Button size="small" disabled={!canEdit || pending || !dirty} loading={pending && !preview} onClick={check}>
          Check
        </Button>
      </Space>

      {preview ? (
        <Alert
          type={preview.willHide.length > 0 ? "warning" : "info"}
          showIcon
          message={`Confirm reporting start date: ${date}`}
          description={
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              {preview.willCreate.map((entry) => (
                <Typography.Text key={`create-${entry.granularity}`}>
                  Will open {entry.count} {entry.granularity} period{entry.count === 1 ? "" : "s"} (
                  {entry.from}–{entry.to}).
                </Typography.Text>
              ))}
              {preview.willHide.map((entry) => (
                <Typography.Text key={`hide-${entry.granularity}`}>
                  Will stop showing {entry.count} {entry.granularity} period
                  {entry.count === 1 ? "" : "s"} for this report: {entry.labels.join(", ")}.
                  Uploaded files are kept, not deleted.
                </Typography.Text>
              ))}
              {preview.willCreate.length === 0 && preview.willHide.length === 0 ? (
                <Typography.Text>
                  No change to what is open for this report — only the date is recorded.
                </Typography.Text>
              ) : null}
              <Button type="primary" size="small" loading={pending} onClick={confirm}>
                Confirm
              </Button>
            </Space>
          }
        />
      ) : null}
    </Space>
  );
}
