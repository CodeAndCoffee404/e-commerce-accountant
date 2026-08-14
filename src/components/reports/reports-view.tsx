"use client";

import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Popconfirm,
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
import { useState, useTransition } from "react";

import { restoreDefaults } from "@/lib/reference/actions";
import { buildReport, deleteRun, republish } from "@/lib/reports/actions";
import { REPORT_DEFINITIONS, type ReportTypeId } from "@/lib/reports/definitions";
import type { ReportAvailability, ReportRunCard } from "@/lib/reports/queries";
import { summariseWarnings } from "@/lib/reports/warnings";

const STATUS_COLOURS: Record<string, string> = {
  queued: "default",
  running: "blue",
  succeeded: "green",
  failed: "red",
};

export function ReportsView({
  runs,
  periods,
  missingRules,
  canBuild,
  canRestore,
}: {
  runs: ReportRunCard[];
  periods: Record<ReportTypeId, ReportAvailability>;
  /** Required channel rules this tenant does not have. Usually empty. */
  missingRules: string[];
  canBuild: boolean;
  /** Restoring defaults changes company settings, so it is the owner's. */
  canRestore: boolean;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<Record<string, string | undefined>>({});
  // Which report is being built, so the other two cards stay still.
  const [building, setBuilding] = useState<ReportTypeId | null>(null);

  const build = (reportType: ReportTypeId) => {
    const periodLabel = choice[reportType];

    if (!periodLabel) {
      message.warning("Choose a period.");
      return;
    }

    setBuilding(reportType);

    startTransition(async () => {
      try {
        const result = await buildReport({ reportType, periodLabel });

        // Ten seconds on a failure: it names the rule or the upload that is
        // missing, which is not readable in three.
        if (result.ok) message.success(result.message, 6);
        else message.error(result.message, 10);

        router.refresh();
      } catch {
        message.error("The server could not be reached — nothing was changed. Check the connection and try again.", 8);
      } finally {
        setBuilding(null);
      }
    });
  };

  return (
    <>
      {/* Above the cards, because a missing rule is not a property of one
          period — it stops every report from every channel that needs it, and
          the fix is one button on another page. */}
      {missingRules.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="Channel rules are missing"
          description={
            <>
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                {missingRules.join(", ")}. Without these, every row from those channels is skipped
                as unrecognised — the report would come out nearly empty rather than fail, so it
                is refused instead.
              </Typography.Paragraph>
              {canRestore ? (
                <Button
                  size="small"
                  type="primary"
                  loading={pending}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        const result = await restoreDefaults();

                        if (result.ok) message.success(result.message, 6);
                        else message.error(result.message, 8);
                      } catch {
                        message.error("The server could not be reached — nothing was changed. Check the connection and try again.", 8);
                      }

                      router.refresh();
                    })
                  }
                >
                  Restore missing defaults now
                </Button>
              ) : (
                <Link href="/settings?tab=rules">
                  Settings &rarr; Channel rules &rarr; Restore missing defaults
                </Link>
              )}
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                Restoring adds only what is absent. Anything you have edited is left alone.
              </Typography.Paragraph>
            </>
          }
        />
      ) : null}

      {/* Grid rather than a row of fixed cards: at 330px each they ran off the
          side of a phone. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {REPORT_DEFINITIONS.filter(
          (definition) => periods[definition.id]?.enabled ?? true,
        ).map((definition) => {
          const availability = periods[definition.id] ?? {
            enabled: true,
            needs: definition.needs,
            ready: [],
            blocked: [],
          };
          const ready = availability.ready;
          const waiting = availability.blocked;

          return (
            <Card key={definition.id} size="small" title={definition.label}>
              <Typography.Paragraph type="secondary" style={{ minHeight: 44 }}>
                {definition.description}
              </Typography.Paragraph>

              {/* Said before anything is uploaded, not discovered afterwards by
                  watching a button stay grey. */}
              <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                <Typography.Text strong style={{ fontSize: 12 }}>
                  Needs:
                </Typography.Text>{" "}
                {availability.needs || definition.needs}
              </Typography.Paragraph>

              <Space.Compact style={{ width: "100%" }}>
                <Select
                  style={{ width: "100%" }}
                  placeholder={ready.length === 0 ? "Nothing ready" : "Period"}
                  disabled={ready.length === 0}
                  value={choice[definition.id]}
                  onChange={(value) =>
                    setChoice((current) => ({ ...current, [definition.id]: value }))
                  }
                  options={ready.map((period) => ({ value: period, label: period }))}
                />
                <Tooltip title="Building again is safe — each run is recorded separately with the rules and rates it used.">
                  <Button
                    type="primary"
                    loading={building === definition.id}
                    disabled={building !== null || !canBuild || ready.length === 0}
                    onClick={() => build(definition.id)}
                  >
                    Build
                  </Button>
                </Tooltip>
              </Space.Compact>

              {ready.length > 0 ? (
                <Typography.Paragraph
                  type="success"
                  style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}
                >
                  <CheckCircleOutlined />{" "}
                  {ready.length === 1
                    ? `Everything is in for ${ready[0]}.`
                    : `Everything is in for ${ready.length} periods, newest ${ready[0]}.`}
                </Typography.Paragraph>
              ) : null}

              {/* A greyed-out card that gives no reason sends someone off to
                  re-upload files that are already here. Naming what is missing
                  is the whole difference between a dead end and a next step. */}
              {waiting.length > 0 ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: 12 }}
                  message={
                    waiting.length === 1
                      ? `${waiting[0].period} is not ready yet`
                      : `${waiting.length} periods are not ready yet`
                  }
                  description={
                    <Space direction="vertical" size={4} style={{ width: "100%" }}>
                      {waiting.slice(0, 3).map((entry) => (
                        <Typography.Text key={entry.period} style={{ fontSize: 12 }}>
                          <b>{entry.period}</b> — still missing:{" "}
                          {entry.missing.slice(0, 6).join(", ")}
                          {entry.missing.length > 6 ? ` and ${entry.missing.length - 6} more` : ""}
                        </Typography.Text>
                      ))}
                      {waiting.length > 3 ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          and {waiting.length - 3} older period
                          {waiting.length - 3 === 1 ? "" : "s"}
                        </Typography.Text>
                      ) : null}
                      {definition.why ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {definition.why}
                        </Typography.Text>
                      ) : null}
                    </Space>
                  }
                />
              ) : null}

              {ready.length === 0 && waiting.length === 0 ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Nothing uploaded for this report yet.
                </Typography.Text>
              ) : null}
            </Card>
          );
        })}
      </div>

      <Table<ReportRunCard>
        dataSource={runs}
        rowKey="id"
        size="small"
        loading={pending}
        scroll={{ x: 1100 }}
        pagination={runs.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
        locale={{
          emptyText: (
            <Empty
              description={
                <span>
                  No reports yet.
                  <br />
                  Pick a period above and build one.
                </span>
              }
            />
          ),
        }}
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
                  <WarningOutlined
                    style={{ color: token.colorWarning }}
                    aria-label={`${run.stats?.warnings?.length} warnings — expand this row`}
                  />
                ) : null}
              </Space>
            ),
          },
          {
            title: (
              <Tooltip title="Rows written into the report, after the channel rules dropped what does not belong in it.">
                Rows
              </Tooltip>
            ),
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
                    {/* A real link: the browser downloads it itself, with its
                        own progress, instead of the file passing through a
                        server action as base64. */}
                    <Button
                      size="small"
                      icon={<DownloadOutlined />}
                      href={`/api/reports/${artifact.id}`}
                      download={artifact.filename}
                    >
                      {artifact.filename.replace(/^.* - /, "").replace(/\.xlsx$/, "")}
                    </Button>
                    {artifact.driveUrl ? (
                      <Tooltip title="Open in Google Drive">
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
            title: "",
            key: "remove",
            width: 60,
            render: (_, run) => (
              <Popconfirm
                title="Remove this report?"
                description="Its files go too. Anything already in Google Drive stays there."
                disabled={!canBuild}
                onConfirm={() =>
                  startTransition(async () => {
                    try {
                      const result = await deleteRun(run.id);

                      if (result.ok) message.success(result.message);
                      else message.error(result.message, 6);
                    } catch {
                      message.error("The server could not be reached — nothing was changed. Check the connection and try again.", 8);
                    }

                    router.refresh();
                  })
                }
              >
                <Button size="small" type="text" danger disabled={!canBuild}>
                  ✕
                </Button>
              </Popconfirm>
            ),
          },
          {
            title: (
              <Tooltip title="Whether the files reached the client's Google Drive. A failed upload does not affect the report — the files are here and can be sent again.">
                Drive
              </Tooltip>
            ),
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
                      try {
                        const result = await republish(run.id);

                        if (result.ok) message.success(result.message, 6);
                        else message.error(result.message, 8);
                      } catch {
                        message.error("The server could not be reached — nothing was changed. Check the connection and try again.", 8);
                      }

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
  // Collapsed here as well as when stored, because runs built before this
  // existed still hold their original three hundred lines.
  const warnings = summariseWarnings(run.stats?.warnings ?? []);
  const shown = warnings.slice(0, 20);

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {run.errorMessage ? <Alert type="error" showIcon message={run.errorMessage} /> : null}

      {warnings.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={warnings.length === 1 ? "Warning" : `Warnings (${warnings.length})`}
          description={
            <>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {shown.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              {warnings.length > shown.length ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  and {warnings.length - shown.length} more
                </Typography.Text>
              ) : null}
            </>
          }
        />
      ) : null}

      <div>
        <Typography.Text strong>Sources</Typography.Text>
        <br />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          The uploads this run read. Rebuilding after a new upload uses whatever is current then.
        </Typography.Text>
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
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Deliberate, not lost: fees, draft orders and anything the channel rules exclude.
          </Typography.Text>
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
