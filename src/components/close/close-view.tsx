"use client";

import {
  CheckCircleFilled,
  CloseCircleOutlined,
  CloudOutlined,
  MinusOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Empty,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  theme,
  Tooltip,
  Typography,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { buildAllReady } from "@/lib/close/actions";
import type { ChecklistItem, CloseData, CloseReport, DeltaRow } from "@/lib/close/queries";

const { Text } = Typography;

/**
 * The month as the accountant actually works it: what is still missing, what
 * can be built, what changed against last month, and what has reached Drive.
 * Everything else in the app is this page's detail view.
 */
export function CloseView({ data, canBuild }: { data: CloseData; canBuild: boolean }) {
  const router = useRouter();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [building, startTransition] = useTransition();

  if (data.months.length === 0) {
    return (
      <Empty
        style={{ marginTop: 48 }}
        description={
          <span>
            Nothing uploaded yet.
            <br />
            Press <b>Upload files</b> above and drop a month&rsquo;s exports — the month appears
            here the moment the first file lands.
          </span>
        }
      />
    );
  }

  const requiredItems = data.items.filter((item) => item.requirement === "required");
  const requiredIn = requiredItems.filter((item) => item.uploaded).length;
  const optionalIn = data.items.filter(
    (item) => item.requirement === "optional" && item.uploaded,
  ).length;

  const buildAll = () => {
    if (!data.month) return;

    const period = data.month;

    startTransition(async () => {
      const result = await buildAllReady({ periodLabel: period });

      if (result.ok) message.success(result.message, 8);
      else message.error(result.message, 12);

      router.refresh();
    });
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space wrap align="center" style={{ justifyContent: "space-between", width: "100%" }}>
        <Space wrap>
          <Text strong>Month</Text>
          <Select
            value={data.month ?? undefined}
            style={{ minWidth: 180 }}
            options={data.months.map((month) => ({ value: month, label: month }))}
            onChange={(month) => router.push(`/close?month=${encodeURIComponent(month)}`)}
          />
        </Space>

        {canBuild ? (
          <Tooltip
            title={
              data.buildable === 0
                ? "Everything ready is already built. Rebuilds and quarters live on Reports."
                : "Builds every report this month is ready for. Each run is recorded separately."
            }
          >
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={building}
              disabled={data.buildable === 0}
              onClick={buildAll}
            >
              {data.buildable === 0
                ? "All built"
                : `Build ${data.buildable} report${data.buildable === 1 ? "" : "s"}`}
            </Button>
          </Tooltip>
        ) : null}
      </Space>

      <Card
        size="small"
        title="Files"
        extra={
          <Text type="secondary" style={{ fontSize: 12 }}>
            {requiredIn} of {requiredItems.length} required in
            {optionalIn > 0 ? ` · ${optionalIn} optional` : ""}
          </Text>
        }
      >
        <Progress
          percent={
            requiredItems.length === 0
              ? 100
              : Math.round((requiredIn / requiredItems.length) * 100)
          }
          size="small"
          style={{ marginBottom: 12, maxWidth: 420 }}
        />

        <Space size={[6, 6]} wrap>
          {data.items.map((item) => (
            <FileChip key={item.key} item={item} />
          ))}
        </Space>

        {requiredIn < requiredItems.length ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "12px 0 0" }}>
            A grey chip is an optional file — it never blocks a build and is counted whenever it
            arrives. Upload with the button above; each file is recognised by its contents.
          </Typography.Paragraph>
        ) : null}
      </Card>

      <Card size="small" title="Reports">
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          {data.reports.map((report) => (
            <ReportLine key={report.id} report={report} />
          ))}
        </Space>
      </Card>

      {data.previousMonth ? (
        <Card
          size="small"
          title={`Compared with ${data.previousMonth}`}
          extra={
            <Text type="secondary" style={{ fontSize: 12 }}>
              Gross by channel and currency, current rows only
            </Text>
          }
        >
          {data.deltas.length === 0 ? (
            <Text type="secondary">
              Nothing to compare — {data.previousMonth} has no data in the ledger.
            </Text>
          ) : (
            <DeltasTable rows={data.deltas} warningBg={token.colorWarningBg} />
          )}
        </Card>
      ) : null}

      <Card size="small" title="History">
        <MatrixTable matrix={data.matrix} selected={data.month} />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "8px 0 0" }}>
          Every month on record. A dot is a file that is there; a dash is an optional one that is
          not. Click a month to open it.
        </Typography.Paragraph>
      </Card>
    </Space>
  );
}

function FileChip({ item }: { item: ChecklistItem }) {
  const icon = item.uploaded ? (
    <CheckCircleFilled />
  ) : item.requirement === "optional" ? (
    <MinusOutlined />
  ) : (
    <CloseCircleOutlined />
  );

  const chip = (
    <Tag
      icon={icon}
      color={item.uploaded ? "green" : item.requirement === "optional" ? "default" : "orange"}
      style={{ marginInlineEnd: 0, opacity: !item.uploaded && item.requirement === "optional" ? 0.65 : 1 }}
    >
      {item.label.replace("Amazon Monthly Transaction report", "Amazon")}
    </Tag>
  );

  return (
    <Tooltip
      title={
        item.uploaded
          ? `${item.filename}${item.rows !== null ? ` · ${item.rows} rows` : ""}`
          : item.requirement === "optional"
            ? "Optional — never blocks a build, counted when it arrives."
            : "Still wanted for this month."
      }
    >
      {chip}
    </Tooltip>
  );
}

function ReportLine({ report }: { report: CloseReport }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: 8,
        justifyContent: "space-between",
      }}
    >
      <Space size={8} wrap>
        <Text strong>{report.label}</Text>

        {report.state === "built" && !report.stale ? (
          <Tag color="green">built</Tag>
        ) : report.state === "built" && report.stale ? (
          <Tooltip title="A file it was built from has been replaced by a re-upload since. The workbook still traces to what it used, but it no longer reflects the ledger — the build button above will rebuild it.">
            <Tag color="orange">built, now stale</Tag>
          </Tooltip>
        ) : report.state === "ready" ? (
          <Tag color="blue">ready to build</Tag>
        ) : (
          <Tag>waiting</Tag>
        )}

        {report.warnings > 0 ? (
          <Tooltip title="Open Reports and expand the run to read them.">
            <Tag icon={<WarningOutlined />} color="orange">
              {report.warnings} warning{report.warnings === 1 ? "" : "s"}
            </Tag>
          </Tooltip>
        ) : null}

        {report.lastFailure ? (
          <Tooltip title={report.lastFailure}>
            <Tag color="red">last attempt failed</Tag>
          </Tooltip>
        ) : null}
      </Space>

      <Space size={8} wrap>
        {report.state === "waiting" ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            missing: {report.missing.slice(0, 6).join(", ")}
            {report.missing.length > 6 ? ` and ${report.missing.length - 6} more` : ""}
          </Text>
        ) : null}

        {report.state === "built" ? <DriveBadge drive={report.drive} /> : null}

        <Link href="/reports" style={{ fontSize: 12 }}>
          details
        </Link>
      </Space>
    </div>
  );
}

function DriveBadge({ drive }: { drive: CloseReport["drive"] }) {
  if (drive.total === 0) return null;

  if (drive.failed > 0) {
    return (
      <Tooltip title="Delivery to Drive failed for some files. Retry lives on Reports; the workbooks are safe here either way.">
        <Tag icon={<CloudOutlined />} color="red">
          Drive: {drive.failed} failed
        </Tag>
      </Tooltip>
    );
  }

  if (drive.pending > 0) {
    return (
      <Tooltip title="Not in Drive yet. If Drive is not connected, connect it under Settings — the workbooks are downloadable here regardless.">
        <Tag icon={<CloudOutlined />}>Drive: not delivered</Tag>
      </Tooltip>
    );
  }

  return (
    <Tag icon={<CloudOutlined />} color="green">
      in Drive
    </Tag>
  );
}

function DeltasTable({ rows, warningBg }: { rows: DeltaRow[]; warningBg: string }) {
  return (
    <Table<DeltaRow>
      dataSource={rows}
      rowKey={(row) => `${row.channel}|${row.country ?? ""}|${row.currency}`}
      size="small"
      pagination={false}
      scroll={{ x: 560 }}
      onRow={(row) => (row.flagged ? { style: { background: warningBg } } : {})}
      columns={[
        {
          title: "Channel",
          render: (_, row) => (
            <Text>
              {row.channel}
              {row.country ? <Text type="secondary"> · {row.country}</Text> : null}
            </Text>
          ),
        },
        { title: "Currency", dataIndex: "currency", width: 90 },
        {
          title: "This month",
          dataIndex: "current",
          align: "right",
          width: 130,
          render: (value: string) => <Text>{value}</Text>,
        },
        {
          title: "Last month",
          dataIndex: "previous",
          align: "right",
          width: 130,
          render: (value: string) => <Text type="secondary">{value}</Text>,
        },
        {
          title: "Change",
          dataIndex: "changePct",
          align: "right",
          width: 110,
          render: (value: number | null, row) => {
            if (value === null) return <Tag color="blue">new</Tag>;

            const text = `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

            return row.flagged ? (
              <Tooltip title="A swing of a quarter or more, or a channel gone quiet. The figure may be perfectly right — but it should be right on purpose.">
                <Text strong>
                  <WarningOutlined /> {text}
                </Text>
              </Tooltip>
            ) : (
              <Text type="secondary">{text}</Text>
            );
          },
        },
      ]}
    />
  );
}

function MatrixTable({
  matrix,
  selected,
}: {
  matrix: CloseData["matrix"];
  selected: string | null;
}) {
  const router = useRouter();
  const { token } = theme.useToken();

  type Row = { key: string; label: string; cells: ("yes" | "no" | "optional")[] };

  return (
    <Table<Row>
      dataSource={matrix.rows}
      rowKey="key"
      size="small"
      pagination={false}
      scroll={{ x: 320 + matrix.months.length * 72 }}
      columns={[
        {
          title: "",
          dataIndex: "label",
          fixed: "left",
          width: 250,
          render: (label: string) => (
            <Text style={{ fontSize: 12 }}>
              {label.replace("Amazon Monthly Transaction report", "Amazon")}
            </Text>
          ),
        },
        ...matrix.months.map((month, index) => ({
          title: (
            <Typography.Link
              onClick={() => router.push(`/close?month=${encodeURIComponent(month)}`)}
              style={{ fontSize: 12, fontWeight: month === selected ? 600 : 400 }}
            >
              {month.slice(0, 7)}
            </Typography.Link>
          ),
          key: month,
          width: 72,
          align: "center" as const,
          render: (_: unknown, row: Row) => {
            const cell = row.cells[index];

            if (cell === "yes") {
              return <CheckCircleFilled style={{ color: token.colorSuccess }} />;
            }

            return (
              <Text type="secondary" style={{ opacity: cell === "optional" ? 0.4 : 0.8 }}>
                —
              </Text>
            );
          },
        })),
      ]}
    />
  );
}
