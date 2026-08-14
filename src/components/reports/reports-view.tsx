"use client";

import { CloudUploadOutlined, DownloadOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Empty, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { buildReport, downloadArtifact, republish } from "@/lib/reports/actions";
import { REPORT_DEFINITIONS, type ReportTypeId } from "@/lib/reports/definitions";
import type { ReportRunCard } from "@/lib/reports/queries";

const STATUS_COLOURS: Record<string, string> = {
  queued: "default",
  running: "blue",
  succeeded: "green",
  failed: "red",
};

export function ReportsView({
  runs,
  periods,
  canBuild,
}: {
  runs: ReportRunCard[];
  periods: Record<ReportTypeId, string[]>;
  canBuild: boolean;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<Record<string, string | undefined>>({});

  const build = (reportType: ReportTypeId) => {
    const periodLabel = choice[reportType];

    if (!periodLabel) {
      message.warning("Выберите период.");
      return;
    }

    startTransition(async () => {
      const result = await buildReport({ reportType, periodLabel });

      if (result.ok) message.success(result.message, 6);
      else message.error(result.message, 10);

      router.refresh();
    });
  };

  const download = (artifactId: string) => {
    startTransition(async () => {
      const result = await downloadArtifact(artifactId);

      if (!result.ok) {
        message.error(result.message, 6);
        return;
      }

      // The store is private, so the bytes come back through the server rather
      // than as a link anyone could follow.
      const link = document.createElement("a");

      link.href = result.dataUrl;
      link.download = result.filename;
      link.click();
    });
  };

  return (
    <>
      <Space wrap align="start" style={{ marginBottom: 24, width: "100%" }}>
        {REPORT_DEFINITIONS.map((definition) => {
          const available = periods[definition.id] ?? [];

          return (
            <Card
              key={definition.id}
              size="small"
              title={definition.label}
              style={{ width: 330 }}
            >
              <Typography.Paragraph type="secondary" style={{ minHeight: 44 }}>
                {definition.description}
              </Typography.Paragraph>

              <Space.Compact style={{ width: "100%" }}>
                <Select
                  style={{ width: "100%" }}
                  placeholder={available.length === 0 ? "Нет данных" : "Период"}
                  disabled={available.length === 0}
                  value={choice[definition.id]}
                  onChange={(value) =>
                    setChoice((current) => ({ ...current, [definition.id]: value }))
                  }
                  options={available.map((period) => ({ value: period, label: period }))}
                />
                <Button
                  type="primary"
                  loading={pending}
                  disabled={!canBuild || available.length === 0}
                  onClick={() => build(definition.id)}
                >
                  Build
                </Button>
              </Space.Compact>
            </Card>
          );
        })}
      </Space>

      <Table<ReportRunCard>
        dataSource={runs}
        rowKey="id"
        size="small"
        loading={pending}
        pagination={runs.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
        locale={{ emptyText: <Empty description="No reports built yet" /> }}
        expandable={{
          expandedRowRender: (run) => <RunDetails run={run} />,
          rowExpandable: (run) => run.sources.length > 0 || run.errorMessage !== null,
        }}
        columns={[
          { title: "Report", dataIndex: "label", width: 230 },
          { title: "Period", dataIndex: "periodLabel", width: 150 },
          {
            title: "Status",
            dataIndex: "status",
            width: 110,
            render: (status: string, run) => (
              <Space size={4}>
                <Tag color={STATUS_COLOURS[status] ?? "default"}>{status}</Tag>
                {(run.stats?.warnings?.length ?? 0) > 0 ? (
                  <Tooltip title={run.stats?.warnings?.join("; ")}>
                    <WarningOutlined style={{ color: "#d48806" }} />
                  </Tooltip>
                ) : null}
              </Space>
            ),
          },
          {
            title: "Rows",
            dataIndex: "stats",
            width: 100,
            render: (stats: ReportRunCard["stats"]) => stats?.outputRows ?? "—",
          },
          {
            title: "Built",
            dataIndex: "requestedAt",
            width: 175,
            render: (value: Date) => new Date(value).toLocaleString("en-GB"),
          },
          {
            title: "Files",
            key: "artifacts",
            render: (_, run) => (
              <Space wrap size={4}>
                {run.artifacts.map((artifact) => (
                  <Space.Compact key={artifact.id} size="small">
                    <Button
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={() => download(artifact.id)}
                    >
                      {artifact.filename.replace(/^.* - /, "").replace(/\.xlsx$/, "")}
                    </Button>
                    {artifact.driveUrl ? (
                      <Tooltip title="Открыть в Google Drive">
                        <Button
                          size="small"
                          href={artifact.driveUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Drive
                        </Button>
                      </Tooltip>
                    ) : null}
                  </Space.Compact>
                ))}
                {run.artifacts.length === 0 ? "—" : null}
              </Space>
            ),
          },
          {
            title: "Drive",
            key: "drive",
            width: 120,
            render: (_, run) => {
              if (run.artifacts.length === 0) return "—";

              const failed = run.artifacts.some((artifact) => artifact.driveStatus === "failed");
              const synced = run.artifacts.every((artifact) => artifact.driveStatus === "synced");

              if (synced) return <Tag color="green">synced</Tag>;

              // A failed upload is not a failed report: the file is here and
              // can be sent again without rebuilding anything.
              return (
                <Button
                  size="small"
                  icon={<CloudUploadOutlined />}
                  danger={failed}
                  loading={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await republish(run.id);

                      if (result.ok) message.success(result.message, 6);
                      else message.error(result.message, 8);

                      router.refresh();
                    })
                  }
                >
                  {failed ? "Retry" : "Send"}
                </Button>
              );
            },
          },
        ]}
      />
    </>
  );
}

function RunDetails({ run }: { run: ReportRunCard }) {
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {run.errorMessage ? <Alert type="error" showIcon message={run.errorMessage} /> : null}

      {(run.stats?.warnings?.length ?? 0) > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="Warnings"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {run.stats?.warnings?.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          }
        />
      ) : null}

      <div>
        <Typography.Text strong>Sources</Typography.Text>
        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          {run.sources.map((source) => (
            <li key={source}>
              <Typography.Text type="secondary">{source}</Typography.Text>
            </li>
          ))}
        </ul>
      </div>

      {(run.stats?.skipped?.length ?? 0) > 0 ? (
        <div>
          <Typography.Text strong>Skipped rows</Typography.Text>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {run.stats?.skipped?.map((entry) => (
              <li key={entry.reason}>
                <Typography.Text type="secondary">
                  {entry.count} — {entry.reason}
                </Typography.Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Space>
  );
}
