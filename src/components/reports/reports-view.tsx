"use client";

import {
  CloudUploadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExportOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
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
import { useMemo, useState, useTransition } from "react";

import { KindIcon } from "@/components/common/kind-icon";
import { PeriodFilterPicker } from "@/components/uploads/period-filter-picker";
import type { PeriodGranularity } from "@/lib/db/schema";
import { comparePeriods, periodGranularityFromLabel, periodLabelWords } from "@/lib/ingest/period";
import { restoreDefaults } from "@/lib/reference/actions";
import { deleteRun, republish } from "@/lib/reports/actions";
import { REPORT_DEFINITIONS, type ReportTypeId } from "@/lib/reports/definitions";
import type { ReportAvailability, ReportPeriodRow, ReportRunCard } from "@/lib/reports/queries";
import { summariseWarnings } from "@/lib/reports/warnings";

import { targetKey, useBuildQueue } from "./build-queue";

const STATUS_TAG: Record<ReportPeriodRow["state"], { color: string; text: string }> = {
  built: { color: "green", text: "built" },
  stale: { color: "gold", text: "built, now stale" },
  ready: { color: "blue", text: "ready" },
  waiting: { color: "default", text: "waiting" },
  failed: { color: "red", text: "failed" },
  running: { color: "processing", text: "building" },
  queued: { color: "processing", text: "queued" },
};

const RUN_STATUS_COLOURS: Record<string, string> = {
  queued: "default",
  running: "blue",
  succeeded: "green",
  failed: "red",
};

/**
 * Display labels only — the stored status (`queued`, `running`, …) never
 * changes, so filtering and the database stay exactly as they were.
 */
const RUN_STATUS_LABELS: Record<string, string> = {
  queued: "Pending",
  running: "Building",
  succeeded: "Ready",
  failed: "Failed",
};

/**
 * The left rail and the periods panel end at the same height, whatever
 * either one holds — both are capped at this many pixels and scroll past it,
 * rather than the taller of the two stretching the row. Sized to exactly
 * five period rows (`PeriodRow`'s own 52px `minHeight` plus its 1px border).
 */
const PANEL_MAX_HEIGHT = 5 * 53;

/** One entry in the left rail — a report, or one tenant-defined variant of one. */
type RailItem = {
  key: string;
  reportType: ReportTypeId;
  /** Set on variant entries; goes with the build so the run names its definition. */
  variant?: string;
  title: string;
  description: string;
  why: string;
  informational: boolean;
  availability: ReportAvailability;
  /** True for the hint entry shown while a variants report has no definitions. */
  placeholder?: boolean;
};

export function ReportsView({
  periods,
  periodRows,
  runs,
  missingRules,
  canBuild,
  canRestore,
  canEditSkuMappings,
  canEditCurrencyMappings,
}: {
  periods: Record<ReportTypeId, ReportAvailability>;
  periodRows: Record<ReportTypeId, ReportPeriodRow[]>;
  runs: ReportRunCard[];
  /** Required channel rules this tenant does not have. Usually empty. */
  missingRules: string[];
  canBuild: boolean;
  /** Restoring defaults changes company settings, so it is the owner's. */
  canRestore: boolean;
  /** SKU mapping is company settings too — same rule, same reason. */
  canEditSkuMappings: boolean;
  /** Allegro's currency_map is company settings too — same rule again. */
  canEditCurrencyMappings: boolean;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [pending, startTransition] = useTransition();

  const { startQueue, runningKey, queueTotal, queueDone, busy, modals } = useBuildQueue({
    canEditSkuMappings,
    canEditCurrencyMappings,
  });

  // One entry per report — and per stored definition where a report comes in
  // tenant-defined variants, each building separately under its own name.
  const items: RailItem[] = useMemo(
    () =>
      REPORT_DEFINITIONS.flatMap((definition): RailItem[] => {
        const availability: ReportAvailability = periods[definition.id] ?? {
          enabled: true,
          needs: definition.needs,
          ready: [],
          blocked: [],
        };

        if (!availability.enabled) return [];

        if (availability.variants === undefined) {
          return [
            {
              key: definition.id,
              reportType: definition.id,
              title: definition.label,
              description: definition.description,
              why: definition.why,
              informational: definition.informational ?? false,
              availability,
            },
          ];
        }

        if (availability.variants.length === 0) {
          return [
            {
              key: definition.id,
              reportType: definition.id,
              title: definition.label,
              description: definition.description,
              why: definition.why,
              informational: definition.informational ?? false,
              availability,
              placeholder: true,
            },
          ];
        }

        return availability.variants.map((variant) => ({
          key: `${definition.id}:${variant.key}`,
          reportType: definition.id,
          variant: variant.key,
          title: variant.name,
          description: variant.summary,
          why: definition.why,
          informational: definition.informational ?? false,
          availability,
        }));
      }),
    [periods],
  );

  const [selectedKey, setSelectedKey] = useState<string>(items[0]?.key ?? "");
  const selected = items.find((item) => item.key === selectedKey) ?? items[0] ?? null;
  const rows = selected ? (periodRows[selected.reportType] ?? []) : [];

  // The run history's own search and filters — client-side, since every run
  // shown here is already in `runs` (the query caps at 50, the same page a
  // filter would otherwise have to re-fetch).
  const [runQuery, setRunQuery] = useState("");
  const [runType, setRunType] = useState<string | undefined>(undefined);
  const [runPeriod, setRunPeriod] = useState<string | undefined>(undefined);
  const [runStatus, setRunStatus] = useState<string | undefined>(undefined);

  const runTypeOptions = useMemo(
    () =>
      [...new Set(runs.map((run) => run.reportType))]
        .map((id) => ({ value: id, label: REPORT_DEFINITIONS.find((d) => d.id === id)?.label ?? id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [runs],
  );
  // The calendar filter wants the same shape the Source files screen feeds
  // it: a label, the date it starts on, and which kind of period it is. A run
  // only carries the label and the start, so the kind is read off the
  // label's own shape.
  const runPeriodOptions = useMemo(() => {
    const byLabel = new Map<string, { label: string; start: string; granularity: PeriodGranularity }>();

    for (const run of runs) {
      if (byLabel.has(run.periodLabel)) continue;

      byLabel.set(run.periodLabel, {
        label: run.periodLabel,
        start: run.periodStart ?? "",
        granularity: periodGranularityFromLabel(run.periodLabel),
      });
    }

    return [...byLabel.values()];
  }, [runs]);
  const runStatusOptions = useMemo(() => [...new Set(runs.map((run) => run.status))], [runs]);

  const filteredRuns = useMemo(() => {
    const q = runQuery.trim().toLowerCase();

    return runs.filter((run) => {
      if (q && !run.label.toLowerCase().includes(q)) return false;
      if (runType && run.reportType !== runType) return false;
      if (runPeriod && run.periodLabel !== runPeriod) return false;
      if (runStatus && run.status !== runStatus) return false;

      return true;
    });
  }, [runs, runQuery, runType, runPeriod, runStatus]);

  return (
    <>
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
                        message.error(
                          "The server could not be reached — nothing was changed. Check the connection and try again.",
                          8,
                        );
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

      {items.length === 0 ? (
        <Empty description="No reports are enabled. Turn one on in Settings → Reports." />
      ) : (
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <ReportRail
            items={items}
            periodRows={periodRows}
            selectedKey={selected?.key ?? ""}
            onSelect={setSelectedKey}
          />

          {selected ? (
            selected.placeholder ? (
              <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Paragraph type="secondary">{selected.description}</Typography.Paragraph>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  No definitions yet. Make one under{" "}
                  <Link href="/settings?tab=custom">Settings &rarr; Custom reports</Link> — it gets
                  its own entry here and builds like any other report.
                </Typography.Text>
              </div>
            ) : (
              <ReportDetail
                item={selected}
                rows={rows}
                canBuild={canBuild}
                runningKey={runningKey}
                queueTotal={queueTotal}
                queueDone={queueDone}
                busy={busy}
                onBuildOne={(row) =>
                  startQueue([
                    {
                      reportType: selected.reportType,
                      periodLabel: row.period,
                      variant: selected.variant,
                      label: `${selected.title} · ${row.period}`,
                    },
                  ])
                }
                onBuildAllReady={() => {
                  const targets = rows
                    .filter((row) => row.state === "ready")
                    .map((row) => ({
                      reportType: selected.reportType,
                      periodLabel: row.period,
                      variant: selected.variant,
                      label: `${selected.title} · ${row.period}`,
                    }));

                  startQueue(targets);
                }}
              />
            )
          ) : null}
        </div>
      )}

      {runs.length > 0 ? (
        <div style={{ marginTop: 24 }}>
          <Typography.Title level={5} style={{ marginBottom: 12 }}>
            Run history
          </Typography.Title>

          <Space wrap style={{ marginBottom: 16 }}>
            <Input.Search
              allowClear
              placeholder="Report"
              style={{ width: 220 }}
              value={runQuery}
              onChange={(event) => setRunQuery(event.target.value)}
            />
            <Select
              allowClear
              showSearch
              style={{ width: 340 }}
              placeholder="Type"
              value={runType}
              onChange={(value) => setRunType(value ?? undefined)}
              options={runTypeOptions}
              popupMatchSelectWidth={false}
              optionRender={(option) => (
                <Tooltip title={option.data.label} placement="right" mouseEnterDelay={0.4}>
                  <span>{option.data.label}</span>
                </Tooltip>
              )}
            />
            <PeriodFilterPicker
              value={runPeriod ?? null}
              options={runPeriodOptions}
              onChange={(value) => setRunPeriod(value ?? undefined)}
            />
            <Select
              allowClear
              style={{ minWidth: 140 }}
              placeholder="Status"
              value={runStatus}
              onChange={(value) => setRunStatus(value ?? undefined)}
              options={runStatusOptions.map((value) => ({
                value,
                label: RUN_STATUS_LABELS[value] ?? value,
              }))}
            />
          </Space>

          <Table<ReportRunCard>
            dataSource={filteredRuns}
            rowKey="id"
            size="small"
            loading={pending}
            scroll={{ x: 1100 }}
            pagination={filteredRuns.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
            locale={{
              emptyText: <Empty description="No reports match these filters." />,
            }}
            expandable={{
              expandedRowRender: (run) => <RunDetails run={run} />,
              rowExpandable: (run) => run.sources.length > 0 || run.errorMessage !== null,
            }}
            columns={[
              { title: "Report", dataIndex: "label", width: 230 },
              {
                title: "Period",
                dataIndex: "periodLabel",
                width: 150,
                // By the period's own start date, not the label text — see
                // the same reasoning on the Source files screen. A quarter
                // starts on the same day as its first month, so the tie is
                // broken by length: January, February, March, then Q1.
                sorter: (a, b) =>
                  comparePeriods(
                    {
                      start: a.periodStart ?? "",
                      granularity: periodGranularityFromLabel(a.periodLabel),
                    },
                    {
                      start: b.periodStart ?? "",
                      granularity: periodGranularityFromLabel(b.periodLabel),
                    },
                  ),
                render: (label: string) => periodLabelWords(label),
              },
              {
                title: "Status",
                dataIndex: "status",
                width: 110,
                render: (status: string, run) => (
                  <Space size={4}>
                    <Tag color={RUN_STATUS_COLOURS[status] ?? "default"}>
                      {RUN_STATUS_LABELS[status] ?? status}
                    </Tag>
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
                        <Button
                          size="small"
                          icon={<DownloadOutlined />}
                          href={`/api/reports/${artifact.id}`}
                          download={artifact.filename}
                        >
                          {artifact.filename.replace(/^.* - /, "").replace(/\.xlsx$/, "")}
                        </Button>
                        {artifact.driveUrl ? (
                          <Tooltip title="Open the workbook in Google Drive — the whole table, with Sheets' own sorting and search.">
                            <Button
                              size="small"
                              icon={<ExportOutlined />}
                              href={artifact.driveUrl}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open ${artifact.filename} in Drive`}
                            />
                          </Tooltip>
                        ) : null}
                      </Space.Compact>
                    ))}
                    {run.artifacts.length === 0 ? "—" : null}
                  </Space>
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
                            message.error(
                              "The server could not be reached — nothing was changed. Check the connection and try again.",
                              8,
                            );
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
              {
                title: "",
                key: "remove",
                width: 60,
                render: (_, run) => (
                  <Popconfirm
                    title="Delete this report?"
                    description="Its files go too. Anything already in Google Drive stays there."
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    cancelText="Keep"
                    disabled={!canBuild}
                    onConfirm={() =>
                      startTransition(async () => {
                        try {
                          const result = await deleteRun(run.id);

                          if (result.ok) message.success(result.message);
                          else message.error(result.message, 6);
                        } catch {
                          message.error(
                            "The server could not be reached — nothing was changed. Check the connection and try again.",
                            8,
                          );
                        }

                        router.refresh();
                      })
                    }
                  >
                    <Button
                      size="small"
                      danger
                      disabled={!canBuild}
                      icon={<DeleteOutlined />}
                      aria-label="Delete"
                    />
                  </Popconfirm>
                ),
              },
            ]}
          />
        </div>
      ) : null}

      {modals}
    </>
  );
}

/** The worst thing about a report's periods, for the rail's status dot. */
function railDotColor(
  rows: ReportPeriodRow[],
  token: {
    colorSuccess: string;
    colorPrimary: string;
    colorWarning: string;
    colorError: string;
    colorTextQuaternary: string;
  },
): string {
  if (rows.some((row) => row.state === "stale")) return token.colorWarning;
  if (rows.some((row) => row.state === "failed")) return token.colorError;
  if (rows.some((row) => row.state === "ready")) return token.colorPrimary;
  if (rows.some((row) => row.state === "built")) return token.colorSuccess;

  return token.colorTextQuaternary;
}

function ReportRail({
  items,
  periodRows,
  selectedKey,
  onSelect,
}: {
  items: RailItem[];
  periodRows: Record<ReportTypeId, ReportPeriodRow[]>;
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const { token } = theme.useToken();
  const official = items.filter((item) => !item.informational);
  const informational = items.filter((item) => item.informational);

  const row = (item: RailItem) => (
    <div
      key={item.key}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.key)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect(item.key);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 10px",
        borderRadius: 6,
        cursor: "pointer",
        background: item.key === selectedKey ? token.colorPrimaryBg : "transparent",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: 99,
          flex: "none",
          background: railDotColor(periodRows[item.reportType] ?? [], token),
        }}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13.5,
          fontWeight: item.key === selectedKey ? 600 : 400,
          color: item.key === selectedKey ? token.colorPrimaryText : token.colorText,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {item.title}
      </span>
    </div>
  );

  return (
    <div
      style={{
        width: 280,
        flex: "none",
        background: token.colorBgContainer,
        border: `1px solid ${token.colorSplit}`,
        borderRadius: 6,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        maxHeight: PANEL_MAX_HEIGHT,
      }}
    >
      <div style={{ overflowY: "auto", flex: 1 }}>
        {official.length > 0 ? (
          <div
            style={{
              padding: "8px 10px 6px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: ".03em",
              color: token.colorTextTertiary,
              textTransform: "uppercase",
            }}
          >
            Official reports
          </div>
        ) : null}
        {official.map(row)}

        {informational.length > 0 ? (
          <div
            style={{
              padding: "14px 10px 6px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: ".03em",
              color: token.colorTextTertiary,
              textTransform: "uppercase",
            }}
          >
            Informational
          </div>
        ) : null}
        {informational.map(row)}
      </div>
    </div>
  );
}

function ReportDetail({
  item,
  rows,
  canBuild,
  runningKey,
  queueTotal,
  queueDone,
  busy,
  onBuildOne,
  onBuildAllReady,
}: {
  item: RailItem;
  rows: ReportPeriodRow[];
  canBuild: boolean;
  /** The target mid-build right now, `${reportType}:${variant}|${period}` — or null when idle. */
  runningKey: string | null;
  queueTotal: number;
  queueDone: number;
  busy: boolean;
  onBuildOne: (row: ReportPeriodRow) => void;
  onBuildAllReady: () => void;
}) {
  const { token } = theme.useToken();
  const readyCount = rows.filter((row) => row.state === "ready").length;

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          background: token.colorBgContainer,
          border: `1px solid ${token.colorSplit}`,
          borderRadius: 6,
          padding: "20px 22px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Typography.Title
              level={5}
              style={{ margin: 0, display: "flex", alignItems: "center", gap: 10 }}
            >
              <KindIcon kind="report" />
              {item.title}
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginTop: 6, marginBottom: 0, maxWidth: 560 }}>
              {item.description}
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>
              <Typography.Text strong style={{ fontSize: 12.5 }}>
                Needs:
              </Typography.Text>{" "}
              {item.availability.needs}
            </Typography.Paragraph>
          </div>

          {canBuild ? (
            <Tooltip
              title={
                readyCount === 0
                  ? "Nothing is ready to build right now."
                  : "Builds every period this report is ready for, one after another."
              }
            >
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={busy}
                disabled={readyCount === 0 || busy}
                onClick={onBuildAllReady}
              >
                {busy && queueTotal > 1
                  ? `Building ${queueDone + 1} of ${queueTotal}…`
                  : readyCount === 0
                    ? "All built"
                    : `Build all ready periods · ${readyCount}`}
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div
        style={{
          background: token.colorBgContainer,
          border: `1px solid ${token.colorSplit}`,
          borderRadius: 6,
          padding: "20px 22px",
        }}
      >
        <Typography.Text strong style={{ fontSize: 13.5 }}>
          Periods
        </Typography.Text>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4, marginBottom: 14 }}>
          Download what is already built, or build what is ready — right from the period it
          belongs to.
        </Typography.Paragraph>

        {rows.length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            Nothing uploaded for this report yet.
          </Typography.Text>
        ) : (
          <div style={{ maxHeight: PANEL_MAX_HEIGHT, overflowY: "auto" }}>
            {rows.map((row) => (
              <PeriodRow
                key={row.period}
                row={row}
                canBuild={canBuild}
                running={
                  runningKey ===
                  targetKey({ reportType: item.reportType, periodLabel: row.period, variant: item.variant, label: "" })
                }
                disabled={
                  busy &&
                  runningKey !==
                    targetKey({ reportType: item.reportType, periodLabel: row.period, variant: item.variant, label: "" })
                }
                onBuild={() => onBuildOne(row)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PeriodRow({
  row,
  canBuild,
  running,
  disabled,
  onBuild,
}: {
  row: ReportPeriodRow;
  canBuild: boolean;
  running: boolean;
  disabled: boolean;
  onBuild: () => void;
}) {
  const { token } = theme.useToken();
  const tag = STATUS_TAG[row.state];

  const meta =
    row.state === "built" || row.state === "stale"
      ? `${row.outputRows ?? "—"} rows · built ${row.builtAt ? new Date(row.builtAt).toLocaleString("en-GB") : "—"}` +
        (row.state === "stale" ? " — a file was replaced since; the download is out of date" : "")
      : row.state === "ready"
        ? "everything is in — not built yet"
        : row.state === "waiting"
          ? row.endsOn
            ? `everything is in; the period ends on ${row.endsOn}`
            : `still missing: ${row.missing.join(", ")}`
          : row.state === "failed"
            ? (row.errorMessage ?? "the last attempt failed")
            : "in progress…";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 4px",
        borderBottom: `1px solid ${token.colorSplit}`,
        minHeight: 52,
      }}
    >
      <span style={{ width: 150, fontSize: 13.5, fontWeight: 500, flex: "none" }}>
        {periodLabelWords(row.period)}
      </span>
      <Tag color={tag.color} style={{ flex: "none" }}>
        {tag.text}
      </Tag>
      <Typography.Text
        type="secondary"
        style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}
        ellipsis={{ tooltip: meta }}
      >
        {meta}
      </Typography.Text>

      <Space size={6} style={{ flex: "none" }}>
        {row.artifact?.driveUrl ? (
          <Tooltip title="Open the workbook in Google Drive — the whole table, with Sheets' own sorting and search.">
            <Button
              size="small"
              icon={<ExportOutlined />}
              href={row.artifact.driveUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${periodLabelWords(row.period)} in Drive`}
            />
          </Tooltip>
        ) : null}

        {row.artifact ? (
          <Tooltip title="Download the workbook this run produced.">
            <Button
              size="small"
              icon={<DownloadOutlined />}
              href={`/api/reports/${row.artifact.id}`}
              download={row.artifact.filename}
            >
              Download
            </Button>
          </Tooltip>
        ) : null}

        {canBuild &&
        (row.state === "ready" || row.state === "built" || row.state === "stale" || row.state === "failed") ? (
          <Tooltip title="Building again is safe — each run is recorded separately with the rules and rates it used.">
            <Button
              size="small"
              type={row.state === "ready" || row.state === "stale" ? "primary" : "default"}
              icon={row.state !== "ready" ? <ReloadOutlined /> : undefined}
              loading={running}
              disabled={disabled}
              onClick={onBuild}
            >
              {row.state === "ready" ? "Build" : row.state === "failed" ? "Retry" : "Rebuild"}
            </Button>
          </Tooltip>
        ) : null}
      </Space>
    </div>
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
          The source files this run read. Rebuilding after a new one uses whatever is current
          then.
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
            Deliberate, not lost: fees, giveaways and anything the channel rules exclude.
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
