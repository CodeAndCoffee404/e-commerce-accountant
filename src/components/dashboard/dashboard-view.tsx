"use client";

import {
  CheckCircleFilled,
  CloseCircleOutlined,
  CloudOutlined,
  MinusOutlined,
  SmileOutlined,
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

import type { AuditRow } from "@/lib/audit/record";
import { buildAllReady } from "@/lib/dashboard/actions";
import type { ChecklistItem, CloseReport, DashboardData } from "@/lib/dashboard/queries";

const { Text, Title } = Typography;

/**
 * The landing page: the month as the accountant actually works it. A greeting
 * that says whether anything needs them, the files and the reports side by
 * side, the history, and what happened lately. Everything else in the app is
 * this page's detail view.
 */
export function DashboardView({
  data,
  activity,
  firstName,
  flaggedRows,
  canBuild,
}: {
  data: DashboardData;
  activity: AuditRow[];
  firstName: string;
  /** Current ledger rows waiting for a person, tenant-wide. */
  flaggedRows: number;
  canBuild: boolean;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const [building, startTransition] = useTransition();

  if (data.months.length === 0) {
    return (
      <>
        <Greeting firstName={firstName} attention={[]} allClear={false} intro="Nothing here yet." />
        <Empty
          style={{ marginTop: 48 }}
          description={
            <span>
              Press <b>Upload files</b> above and drop a month&rsquo;s exports — the month appears
              here the moment the first file lands.
            </span>
          }
        />
      </>
    );
  }

  const requiredItems = data.items.filter((item) => item.requirement === "required");
  const requiredIn = requiredItems.filter((item) => item.uploaded).length;
  const missingRequired = requiredItems.length - requiredIn;
  const built = data.reports.filter((report) => report.state === "built" && !report.stale).length;
  const stale = data.reports.filter((report) => report.stale).length;
  const driveFailed = data.reports.reduce((total, report) => total + report.drive.failed, 0);

  // What actually needs a person, with a way to it. Order: by how wrong it is
  // to ignore.
  const attention: { key: string; text: string; href: string }[] = [];

  if (flaggedRows > 0) {
    attention.push({
      key: "flagged",
      text: `${flaggedRows} row${flaggedRows === 1 ? "" : "s"} could not be read — review`,
      href: "/uploads",
    });
  }
  if (missingRequired > 0) {
    attention.push({
      key: "missing",
      text: `${missingRequired} required file${missingRequired === 1 ? "" : "s"} still wanted`,
      href: "#dashboard-files",
    });
  }
  if (stale > 0) {
    attention.push({
      key: "stale",
      text: `${stale} report${stale === 1 ? "" : "s"} built before a re-upload — rebuild`,
      href: "#dashboard-reports",
    });
  }
  if (driveFailed > 0) {
    attention.push({
      key: "drive",
      text: `Drive delivery failed for ${driveFailed} file${driveFailed === 1 ? "" : "s"} — retry`,
      href: "/reports",
    });
  }

  const allClear = attention.length === 0 && data.buildable === 0;

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
      <Greeting
        firstName={firstName}
        attention={attention}
        allClear={allClear}
        intro={`${data.month}: ${requiredIn} of ${requiredItems.length} required files in, ${built} of ${data.reports.length} reports built.`}
      />

      <Space wrap align="center" style={{ justifyContent: "space-between", width: "100%" }}>
        <Space wrap>
          <Text strong>Month</Text>
          <Select
            value={data.month ?? undefined}
            style={{ minWidth: 180 }}
            options={data.months.map((month) => ({ value: month, label: month }))}
            onChange={(month) => router.push(`/dashboard?month=${encodeURIComponent(month)}`)}
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

      {/* Side by side: the two halves of the ritual — what went in, what came
          out — read as one row, not a scroll. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div id="dashboard-files">
          <Card
            size="small"
            title="Uploads"
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {requiredIn}/{requiredItems.length} required
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
              style={{ marginBottom: 12 }}
            />

            <Space size={[6, 6]} wrap>
              {data.items.map((item) => (
                <FileChip key={item.key} item={item} />
              ))}
            </Space>
          </Card>
        </div>

        <div id="dashboard-reports">
          <Card
            size="small"
            title="Reports"
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {built}/{data.reports.length} built
              </Text>
            }
          >
            <Space direction="vertical" size="small" style={{ width: "100%" }}>
              {data.reports.map((report) => (
                <ReportLine key={report.id} report={report} />
              ))}
            </Space>
          </Card>
        </div>
      </div>

      <Card size="small" title="History">
        <MatrixTable matrix={data.matrix} selected={data.month} />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "8px 0 0" }}>
          Every month on record. A dot is a file that is there; a dash is an optional one that is
          not. Click a month to open it.
        </Typography.Paragraph>
      </Card>

      <Card
        size="small"
        title="Activity"
        extra={
          <Link href="/settings?tab=activity" style={{ fontSize: 12 }}>
            All activity
          </Link>
        }
      >
        {activity.length === 0 ? (
          <Text type="secondary">Nothing has happened yet.</Text>
        ) : (
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            {activity.map((row) => (
              <div
                key={row.id}
                style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}
              >
                <Text type="secondary" style={{ fontSize: 12, minWidth: 130 }}>
                  {new Date(row.createdAt).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
                <Tag style={{ marginInlineEnd: 0 }}>{row.action}</Tag>
                <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                  {row.userEmail ?? ""}
                </Text>
              </div>
            ))}
          </Space>
        )}
      </Card>
    </Space>
  );
}

function Greeting({
  firstName,
  attention,
  allClear,
  intro,
}: {
  firstName: string;
  attention: { key: string; text: string; href: string }[];
  allClear: boolean;
  intro: string;
}) {
  const { token } = theme.useToken();

  return (
    <div style={{ marginBottom: 8 }}>
      <Title level={3} style={{ marginBottom: 4 }}>
        Hey, {firstName}
      </Title>
      <Text type="secondary">{intro}</Text>

      {allClear ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
          <SmileOutlined style={{ color: token.colorSuccess, fontSize: 20 }} />
          <Text strong style={{ color: token.colorSuccess }}>
            Everything is in order — nothing needs you. Have a great day.
          </Text>
        </div>
      ) : attention.length > 0 ? (
        <Space size={[8, 8]} wrap style={{ marginTop: 12 }}>
          {attention.map((item) =>
            item.href.startsWith("#") ? (
              <Button key={item.key} size="small" icon={<WarningOutlined />} href={item.href}>
                {item.text}
              </Button>
            ) : (
              <Link key={item.key} href={item.href}>
                <Button size="small" icon={<WarningOutlined />}>
                  {item.text}
                </Button>
              </Link>
            ),
          )}
        </Space>
      ) : null}
    </div>
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
      <Tag
        icon={icon}
        color={item.uploaded ? "green" : item.requirement === "optional" ? "default" : "orange"}
        style={{
          marginInlineEnd: 0,
          opacity: !item.uploaded && item.requirement === "optional" ? 0.65 : 1,
        }}
      >
        {item.label.replace("Amazon Monthly Transaction report", "Amazon")}
      </Tag>
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
        <Text strong style={{ fontSize: 13 }}>
          {report.label}
        </Text>

        {report.state === "built" && !report.stale ? (
          <Tag color="green">built</Tag>
        ) : report.state === "built" && report.stale ? (
          <Tooltip title="A file it was built from has been replaced by a re-upload since. The build button above will rebuild it.">
            <Tag color="orange">built, now stale</Tag>
          </Tooltip>
        ) : report.state === "ready" ? (
          <Tag color="blue">ready</Tag>
        ) : (
          <Tag>waiting</Tag>
        )}

        {report.warnings > 0 ? (
          <Tooltip title="Open Reports and expand the run to read them.">
            <Tag icon={<WarningOutlined />} color="orange">
              {report.warnings}
            </Tag>
          </Tooltip>
        ) : null}

        {report.lastFailure ? (
          <Tooltip title={report.lastFailure}>
            <Tag color="red">failed</Tag>
          </Tooltip>
        ) : null}

        {report.state === "built" ? <DriveBadge drive={report.drive} /> : null}
      </Space>

      {report.state === "waiting" ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          missing: {report.missing.slice(0, 4).join(", ")}
          {report.missing.length > 4 ? ` and ${report.missing.length - 4} more` : ""}
        </Text>
      ) : (
        <Link href="/reports" style={{ fontSize: 12 }}>
          details
        </Link>
      )}
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
        <Tag icon={<CloudOutlined />}>not in Drive</Tag>
      </Tooltip>
    );
  }

  return (
    <Tag icon={<CloudOutlined />} color="green">
      in Drive
    </Tag>
  );
}

function MatrixTable({
  matrix,
  selected,
}: {
  matrix: DashboardData["matrix"];
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
              onClick={() => router.push(`/dashboard?month=${encodeURIComponent(month)}`)}
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
