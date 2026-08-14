"use client";

import { Alert, Descriptions, Space, Tag, Typography } from "antd";
import Link from "next/link";

import type { FileReconciliation } from "@/lib/uploads/reconciliation";

function trim(value: string): string {
  return value.includes(".") ? value.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1") : value;
}

/**
 * The reconciliation for one uploaded file.
 *
 * Shown per file rather than as a summary: "everything balances" is a claim
 * nobody can check, while "this file offered 420 rows, 420 are in the ledger"
 * is one they can.
 */
export function ReconciliationPanel({
  fileId,
  data,
  period,
  dataset,
}: {
  fileId: string;
  data: FileReconciliation | undefined;
  period: string | null;
  dataset: string | null;
}) {
  if (!data) {
    return <Typography.Text type="secondary">No reconciliation for this file yet.</Typography.Text>;
  }

  const dropped =
    data.sourceRows !== null && data.mappedRows !== null ? data.sourceRows - data.mappedRows : null;
  const superseded = data.currentRows === 0 && data.supersededRows > 0;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {superseded ? (
        <Alert
          type="warning"
          showIcon
          message="A later upload replaced this file"
          description="Its rows are kept but no longer count towards reports. Reports built before the replacement still trace back to them."
        />
      ) : null}

      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }} bordered>
        <Descriptions.Item label="Rows in file">{data.sourceRows ?? "—"}</Descriptions.Item>
        <Descriptions.Item label="Mapped">{data.mappedRows ?? "—"}</Descriptions.Item>
        <Descriptions.Item label="In ledger now">
          {data.currentRows}
          {data.supersededRows > 0 ? (
            <Typography.Text type="secondary"> (+{data.supersededRows} replaced)</Typography.Text>
          ) : null}
        </Descriptions.Item>
        <Descriptions.Item label="Needs attention">
          {data.needsAttention === 0 ? (
            <Tag color="green">none</Tag>
          ) : (
            <Link href={`/transactions?attention=1${period ? `&period=${encodeURIComponent(period)}` : ""}`}>
              <Tag color="orange">{data.needsAttention} — review</Tag>
            </Link>
          )}
        </Descriptions.Item>
      </Descriptions>

      {dropped !== null && dropped > 0 ? (
        <Typography.Text type="secondary">
          {dropped} row{dropped === 1 ? "" : "s"} in the file produced no transaction. That is
          normal for a statement: blank lines, and for Allegro the lines that are its own fees
          rather than sales.
        </Typography.Text>
      ) : null}

      {dropped !== null && dropped < 0 ? (
        <Alert
          type="error"
          showIcon
          message="More transactions than rows"
          description="This should not happen. Please report it — the file and its period are enough to find it."
        />
      ) : null}

      {data.totals.length > 0 ? (
        <div>
          <Typography.Text strong>Totals in the ledger</Typography.Text>
          <br />
          <Space wrap style={{ marginTop: 6 }}>
            {data.totals.map((total) => (
              <Tag key={total.currency} style={{ padding: "3px 8px" }}>
                <b>{total.currency}</b> · gross {trim(total.gross)} · VAT {trim(total.vat)}
              </Tag>
            ))}
          </Space>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Compare with the file itself — these are sums of what was stored, not of what was
            reported.
          </Typography.Text>
        </div>
      ) : null}

      <Link
        href={`/transactions?${new URLSearchParams({
          ...(dataset ? { dataset } : {}),
          ...(period ? { period } : {}),
        }).toString()}`}
      >
        Open these transactions
      </Link>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        File reference: {fileId}
      </Typography.Text>
    </Space>
  );
}
