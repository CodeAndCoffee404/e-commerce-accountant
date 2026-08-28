"use client";

import {
  CheckCircleFilled,
  CloudUploadOutlined,
  DownloadOutlined,
  ExportOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Progress,
  Space,
  Table,
  theme,
  Tooltip,
  Typography,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";

import type { AuditRow } from "@/lib/audit/record";
import type { ChecklistItem, CloseReport, DashboardData } from "@/lib/dashboard/queries";
import { monthLabelName, monthLabelShort } from "@/lib/ingest/period";
import type { DeadlineDashboardRow } from "@/lib/reports/deadlines-queries";

import { KindIcon } from "@/components/common/kind-icon";
import { targetKey, useBuildQueue } from "@/components/reports/build-queue";
import { republish } from "@/lib/reports/actions";

import { MonthPicker } from "./month-picker";
import { ReportDeadlinesBlock } from "./report-deadlines-block";
import { staleStyle } from "./stale-style";

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
  deadlines,
  canBuild,
  canEditSkuMappings,
  canEditCurrencyMappings,
  uploadAction,
}: {
  data: DashboardData;
  activity: AuditRow[];
  firstName: string;
  /** Current ledger rows waiting for a person, tenant-wide. */
  flaggedRows: number;
  /** Reports due for their current reporting period, already sorted. */
  deadlines: DeadlineDashboardRow[];
  canBuild: boolean;
  /** SKU mapping is company settings — only the owner sees the gate's form. */
  canEditSkuMappings: boolean;
  /** Allegro's currency_map is company settings too — same rule again. */
  canEditCurrencyMappings: boolean;
  /** The Upload files control, provided by the page so roles stay server-side. */
  uploadAction: React.ReactNode;
}) {
  const router = useRouter();
  const { token } = theme.useToken();
  const { startQueue, runningKey, queueTotal, queueDone, busy, modals } = useBuildQueue({
    canEditSkuMappings,
    canEditCurrencyMappings,
  });
  // Switching months is a server round trip. Until the new page commits, the
  // month the user asked for is the one we show as chosen, with a spinner on
  // it — otherwise the click looks ignored and gets repeated.
  const [switching, startSwitch] = useTransition();
  const [requestedMonth, setRequestedMonth] = useState<string | null>(null);
  const shownMonth = switching && requestedMonth ? requestedMonth : data.month;

  const goToMonth = (month: string) => {
    if (switching || month === data.month) return;

    setRequestedMonth(month);
    startSwitch(() => {
      router.push(`/dashboard?month=${encodeURIComponent(month)}`);
    });
  };

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

  // Same shortlist the server used to compute for `data.buildable`: never
  // built, or built before a re-upload made the run stale. `data.reports`
  // already carries both, one entry per report for the month shown.
  const buildAll = () => {
    if (!data.month) return;

    const period = data.month;
    const targets = data.reports
      .filter((report) => report.state === "ready" || report.stale)
      .map((report) => ({
        reportType: report.id,
        periodLabel: period,
        label: `${report.label} · ${period}`,
      }));

    startQueue(targets);
  };

  // A single report, built on its own — the same queue the "Build all"
  // button feeds, handed one target instead of every ready one.
  const buildOne = (report: CloseReport) => {
    if (!data.month) return;

    startQueue([
      {
        reportType: report.id,
        periodLabel: data.month,
        label: `${report.label} · ${data.month}`,
      },
    ]);
  };

  const empty = data.months.length === 0;

  // The Hero's eyebrow speaks about the month on show: its name, and whether
  // its reports are all built ("filed") or still owed ("open").
  const periodName = shownMonth ? monthLabelName(shownMonth) : null;
  const period =
    !empty && periodName
      ? {
          name: periodName,
          open: !(data.reports.length > 0 && built === data.reports.length),
        }
      : null;

  return (
    <>
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      {/* Row 1: greeting and overall progress, with what's due this month
          alongside — the two things worth seeing before anything else. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "stretch" }}>
        <div style={{ flex: "3 1 480px", display: "flex", minWidth: 0 }}>
          <Hero
            firstName={firstName}
            period={period}
            switching={switching}
            intro={
              empty
                ? "Nothing uploaded yet. Press Upload files above and drop a month's exports — the month appears here the moment the first file lands."
                : null
            }
            attention={attention}
            allClear={!empty && allClear}
            rings={
              empty
                ? null
                : {
                    files: { done: requiredIn, total: requiredItems.length },
                    reports: { done: built, total: data.reports.length },
                  }
            }
            toolbar={
              empty ? (
                uploadAction
              ) : (
                <Space wrap>
                  {uploadAction}
                  <MonthPicker
                    months={data.months}
                    value={shownMonth}
                    loading={switching}
                    disabled={switching}
                    onChange={goToMonth}
                  />
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
                        loading={busy}
                        disabled={data.buildable === 0 || busy}
                        onClick={buildAll}
                      >
                        {busy && queueTotal > 1
                          ? `Building ${queueDone + 1} of ${queueTotal}…`
                          : data.buildable === 0
                            ? "All built"
                            : `Build ${data.buildable} report${data.buildable === 1 ? "" : "s"}`}
                      </Button>
                    </Tooltip>
                  ) : null}
                </Space>
              )
            }
          />
        </div>

        <div style={{ flex: "1 1 260px", display: "flex", minWidth: 0 }}>
          <ReportDeadlinesBlock rows={deadlines} month={shownMonth} switching={switching} />
        </div>
      </div>

      {empty ? null : (
        <>
      {/* Side by side: the two halves of the ritual — what went in, what came
          out — read as one row, not a scroll. */}
      <div
        className="ea-rise ea-rise-1"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
          gap: 12,
          // Stretch, not start: two cards of one row are one shelf, and a
          // ragged bottom edge reads as a layout accident.
          alignItems: "stretch",
        }}
      >
        <div id="dashboard-files" style={{ display: "flex" }}>
          <Card
            size="small"
            title={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <KindIcon kind="upload" size={22} />
                Uploads
              </span>
            }
            style={{ width: "100%", ...staleStyle(switching) }}
            // The kind's own colour fills the title strip: the same amber that
            // marks an upload everywhere else, so the two cards of this row are
            // told apart before either title is read. The body stays plain, so
            // the colour reads as a label rather than as noise.
            styles={{ header: { background: token.colorWarningBg, borderRadius: 0 } }}
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {requiredIn}/{requiredItems.length}
              </Text>
            }
          >
            <UploadsBody items={data.items} />
          </Card>
        </div>

        <div id="dashboard-reports" style={{ display: "flex" }}>
          <Card
            size="small"
            title={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <KindIcon kind="report" size={22} />
                Reports
              </span>
            }
            style={{ width: "100%", ...staleStyle(switching) }}
            styles={{ header: { background: token.colorPrimaryBg, borderRadius: 0 } }}
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {built}/{data.reports.length} built
              </Text>
            }
          >
            <Space direction="vertical" size="small" style={{ width: "100%" }}>
              {data.reports.map((report) => {
                const key = data.month
                  ? targetKey({
                      reportType: report.id,
                      periodLabel: data.month,
                      label: "",
                    })
                  : null;

                return (
                  <ReportLine
                    key={report.id}
                    report={report}
                    canBuild={canBuild}
                    building={key !== null && runningKey === key}
                    buildDisabled={busy && runningKey !== key}
                    onBuild={() => buildOne(report)}
                  />
                );
              })}
            </Space>
          </Card>
        </div>
      </div>

      <Card size="small" title="History" className="ea-rise ea-rise-2">
        <MatrixTable
          matrix={data.matrix}
          selected={shownMonth}
          switching={switching}
          onSelect={goToMonth}
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: "6px 0 0" }}>
          Every month on record: a dot is a file that is there, a dash is one that is not.
        </Typography.Paragraph>
      </Card>

        </>
      )}

      <Card
        size="small"
        title="Activity"
        className="ea-rise ea-rise-3"
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
                style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
              >
                <Dot color={activityTone(row.action, token)} size={6} />
                <Text type="secondary" style={{ fontSize: 12, minWidth: 96 }}>
                  {new Date(row.createdAt).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
                <Text style={{ fontSize: 12 }}>{row.action}</Text>
                <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                  {row.userEmail ?? ""}
                </Text>
              </div>
            ))}
          </Space>
        )}
      </Card>
    </Space>
    {modals}
    </>
  );
}

function subscribeNever(): () => void {
  return () => undefined;
}

function timeGreeting(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";

  return "Good evening";
}

function Hero({
  firstName,
  period,
  switching,
  intro,
  attention,
  allClear,
  rings,
  toolbar,
}: {
  firstName: string;
  /** The month on show, for the eyebrow line. */
  period: { name: string; open: boolean } | null;
  /**
   * A month switch is in flight: `attention`, `allClear` and `rings` are
   * still last month's numbers until the new page commits, so they dim
   * rather than sit there looking current. `period.open` is the same kind
   * of number — dropped from the eyebrow rather than shown stale.
   */
  switching: boolean;
  intro: string | null;
  attention: { key: string; text: string; href: string }[];
  allClear: boolean;
  rings: {
    files: { done: number; total: number };
    reports: { done: number; total: number };
  } | null;
  toolbar: React.ReactNode;
}) {
  const { token } = theme.useToken();
  // "Hey" on the server and for the first client paint, the time of day once
  // the visitor's clock is knowable. useSyncExternalStore's server snapshot is
  // the sanctioned way to render one thing on the server and another after
  // hydration without a cascading effect.
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const greeting = mounted ? timeGreeting(new Date().getHours()) : "Hey";
  // The eyebrow's date is the visitor's own calendar, so it waits for the
  // client clock the same way the greeting does.
  const todayLine = mounted
    ? new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
    : null;
  const periodLine = period
    ? switching
      ? `${period.name} period`
      : `${period.name} period ${period.open ? "open" : "filed"}`
    : null;
  const eyebrow = [todayLine, periodLine].filter(Boolean).join(" · ");

  return (
    <section
      className="ea-rise"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 16,
        border: `1px solid ${token.colorSplit}`,
        background: token.colorBgContainer,
        padding: "clamp(14px, 2vw, 20px)",
        width: "100%",
      }}
    >
      {/* Colour lives in an overlay, not the surface: the tokens stay in
          charge of contrast in both themes. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            `linear-gradient(130deg, ${token.colorPrimaryBg} 0%, transparent 55%),` +
            `radial-gradient(560px 220px at 90% -10%, ${token.colorSuccessBg}, transparent 70%)`,
          opacity: 0.9,
        }}
      />

      <div
        style={{
          position: "relative",
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          {eyebrow ? (
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: token.colorPrimary,
                marginBottom: 4,
              }}
            >
              {eyebrow}
            </div>
          ) : null}
          <Title level={3} style={{ margin: 0 }}>
            {greeting}, {firstName} <span aria-hidden>👋</span>
          </Title>
          {intro ? (
            <Text type="secondary" style={{ display: "block", marginTop: 6 }}>
              {intro}
            </Text>
          ) : null}

          <div style={staleStyle(switching)}>
            {allClear ? (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 10,
                  padding: "5px 12px",
                  borderRadius: 999,
                  background: token.colorSuccessBg,
                  border: `1px solid ${token.colorSuccessBorder}`,
                }}
              >
                <CheckCircleFilled style={{ color: token.colorSuccess }} />
                <Text strong style={{ color: token.colorSuccessText }}>
                  Everything is in order — nothing needs you. Have a great day.
                </Text>
              </div>
            ) : attention.length > 0 ? (
              <Space size={[8, 8]} wrap style={{ marginTop: 10 }}>
                {attention.map((item) =>
                  item.href.startsWith("#") ? (
                    <Button
                      key={item.key}
                      size="small"
                      shape="round"
                      icon={<WarningOutlined style={{ color: token.colorWarning }} />}
                      href={item.href}
                    >
                      {item.text}
                    </Button>
                  ) : (
                    <Link key={item.key} href={item.href}>
                      <Button
                        size="small"
                        shape="round"
                        icon={<WarningOutlined style={{ color: token.colorWarning }} />}
                      >
                        {item.text}
                      </Button>
                    </Link>
                  ),
                )}
              </Space>
            ) : null}
          </div>

          {toolbar ? <div style={{ marginTop: 14 }}>{toolbar}</div> : null}
        </div>

        {rings ? (
          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              ...staleStyle(switching),
            }}
          >
            <Ring label="files in" done={rings.files.done} total={rings.files.total} />
            <Ring label="reports built" done={rings.reports.done} total={rings.reports.total} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Ring({ label, done, total }: { label: string; done: number; total: number }) {
  const { token } = theme.useToken();
  const percent = total === 0 ? 100 : Math.round((done / total) * 100);
  const complete = total > 0 && done === total;

  return (
    <Progress
      type="dashboard"
      size={92}
      percent={percent}
      // The arc sweeps primary into success; a finished ring settles on
      // success alone.
      strokeColor={
        complete
          ? token.colorSuccess
          : { "0%": token.colorPrimary, "100%": token.colorSuccess }
      }
      strokeWidth={9}
      format={() => (
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontSize: 18, fontWeight: 650, color: token.colorText }}>
            {done}
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              /{total}
            </Text>
          </div>
          <div style={{ fontSize: 10, color: token.colorTextSecondary }}>{label}</div>
        </div>
      )}
    />
  );
}

/** Colour by what the action did, not by which table it touched. */
function activityTone(action: string, token: { colorError: string; colorPrimary: string; colorSuccess: string; colorTextQuaternary: string }): string {
  if (action.endsWith(".deleted") || action.endsWith(".failed") || action.endsWith(".suspended")) {
    return token.colorError;
  }
  if (action.startsWith("report.")) return token.colorPrimary;
  if (action.startsWith("upload.")) return token.colorSuccess;

  return token.colorTextQuaternary;
}

function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        display: "inline-block",
        flex: "none",
      }}
    />
  );
}

function FileChip({ item, wanted = false }: { item: ChecklistItem; wanted?: boolean }) {
  const { token } = theme.useToken();

  // Fourteen solid orange tags shout; fourteen quiet chips with a status dot
  // read. The dot is the state, the chip is just a name.
  const dot = item.uploaded
    ? token.colorSuccess
    : item.requirement === "optional"
      ? token.colorTextQuaternary
      : token.colorWarning;

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
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "3px 10px",
          borderRadius: 999,
          // A chip standing alone because the file is missing carries the
          // warning colour itself; in the full list, where every chip is one
          // of fourteen, the dot is enough and a wall of amber would not be.
          background: wanted ? token.colorWarningBg : token.colorFillTertiary,
          fontSize: 12,
          color: wanted
            ? token.colorWarningText
            : item.uploaded
              ? token.colorText
              : token.colorTextSecondary,
          opacity: !item.uploaded && item.requirement === "optional" ? 0.65 : 1,
          cursor: "default",
        }}
      >
        <Dot color={dot} />
        {item.label.replace("Amazon Monthly Transaction report", "Amazon")}
      </span>
    </Tooltip>
  );
}

/**
 * The month's files, said as briefly as the month allows: one line while
 * everything required is in, and the chips only for what is not. Fourteen
 * green chips saying "all fine" cost more attention than the sentence they
 * add up to — and they buried the one amber chip that mattered.
 */
function UploadsBody({ items }: { items: ChecklistItem[] }) {
  const { token } = theme.useToken();
  const [expanded, setExpanded] = useState(false);

  const missing = items.filter((item) => item.requirement === "required" && !item.uploaded);
  const required = items.filter((item) => item.requirement === "required");

  if (items.length === 0) {
    return (
      <Text type="secondary" style={{ fontSize: 12.5 }}>
        No files are expected for this month.
      </Text>
    );
  }

  if (missing.length > 0) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
          <WarningOutlined style={{ color: token.colorWarning, fontSize: 14 }} />
          <Text style={{ fontSize: 13 }}>
            {missing.length} of {required.length} required file
            {required.length === 1 ? "" : "s"} still missing.
          </Text>
        </div>
        <Space size={[6, 6]} wrap>
          {missing.map((item) => (
            <FileChip key={item.key} item={item} wanted />
          ))}
        </Space>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 15 }} />
        <Text style={{ fontSize: 13 }}>Every required file is in.</Text>
        <Button
          type="link"
          size="small"
          style={{ paddingInline: 2 }}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Hide" : `Show all ${items.length}`}
        </Button>
      </div>

      {expanded ? (
        <Space size={[6, 6]} wrap style={{ marginTop: 12 }}>
          {items.map((item) => (
            <FileChip key={item.key} item={item} />
          ))}
        </Space>
      ) : null}
    </div>
  );
}

/**
 * One report, one status. The state is a coloured dot with the word in its
 * tooltip rather than a badge, because three badges on one line — built,
 * warnings, failed — read as three statuses that contradict each other.
 *
 * There is always a second icon beside Download: the workbook either opens
 * in Drive or can be sent there, so "not in Drive" is a thing to act on
 * rather than a label to read.
 */
function ReportLine({
  report,
  canBuild,
  building,
  buildDisabled,
  onBuild,
}: {
  report: CloseReport;
  canBuild: boolean;
  /** This report is the one the queue is building right now. */
  building: boolean;
  /** Something else is building: this row's button waits its turn. */
  buildDisabled: boolean;
  onBuild: () => void;
}) {
  const { token } = theme.useToken();
  const router = useRouter();
  const { message } = App.useApp();
  const [sending, startSending] = useTransition();

  // Same shortlist the "Build all" button uses: never built, or built before
  // a re-upload made the run stale.
  const buildable = report.state === "ready" || report.stale;
  const status = report.stale
    ? { color: token.colorWarning, text: "Built, but a file it used has been replaced since." }
    : report.state === "built"
      ? { color: token.colorSuccess, text: "Built." }
      : report.state === "ready"
        ? { color: token.colorPrimary, text: "Everything is in — ready to build." }
        : { color: token.colorTextQuaternary, text: "Waiting for files." };

  const sendToDrive = () => {
    const runId = report.runId;

    if (!runId) return;

    startSending(async () => {
      try {
        const result = await republish(runId);

        if (result.ok) message.success(result.message, 5);
        else message.error(result.message, 8);
      } catch {
        message.error("The server could not be reached — nothing was changed.", 8);
      }

      router.refresh();
    });
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        justifyContent: "space-between",
        minHeight: 30,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <Tooltip title={status.text}>
          <span style={{ display: "inline-flex" }}>
            <Dot color={status.color} />
          </span>
        </Tooltip>

        <Text style={{ fontSize: 13 }} ellipsis={{ tooltip: report.label }}>
          {report.label}
        </Text>

        {report.lastFailure ? (
          <Tooltip title={`The last attempt failed: ${report.lastFailure}`}>
            <WarningOutlined style={{ color: token.colorError, fontSize: 12.5, flex: "none" }} />
          </Tooltip>
        ) : null}

        {report.warnings > 0 ? (
          <Tooltip
            title={`${report.warnings} warning${report.warnings === 1 ? "" : "s"} — open Reports and expand the run to read them.`}
          >
            <WarningOutlined style={{ color: token.colorWarning, fontSize: 12.5, flex: "none" }} />
          </Tooltip>
        ) : null}
      </div>

      {report.state === "waiting" ? (
        <Text type="secondary" style={{ fontSize: 12, flex: "none" }} ellipsis>
          missing: {report.missing.slice(0, 3).join(", ")}
          {report.missing.length > 3 ? ` +${report.missing.length - 3}` : ""}
        </Text>
      ) : (
        <Space size={2} style={{ flex: "none" }}>
          {report.artifact?.driveUrl ? (
            <Tooltip title="Open in Google Drive — the whole table, with Sheets' own sorting and search.">
              <Button
                size="small"
                type="text"
                icon={<ExportOutlined />}
                href={report.artifact.driveUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${report.label} in Drive`}
              />
            </Tooltip>
          ) : report.artifact && report.runId ? (
            <Tooltip title="Not in Drive yet — send it now.">
              <Button
                size="small"
                type="text"
                icon={<CloudUploadOutlined />}
                loading={sending}
                onClick={sendToDrive}
                aria-label={`Send ${report.label} to Drive`}
              />
            </Tooltip>
          ) : null}

          {report.artifact ? (
            <Tooltip title="Download the workbook this run produced.">
              <Button
                size="small"
                type="text"
                icon={<DownloadOutlined />}
                href={`/api/reports/${report.artifact.id}`}
                download={report.artifact.filename}
                aria-label={`Download ${report.label}`}
              />
            </Tooltip>
          ) : null}

          {canBuild && buildable ? (
            <Tooltip
              title={
                report.stale
                  ? "A file it was built from has been replaced since. Building again records a separate run."
                  : "Builds this report alone. The run is recorded with the rules and rates it used."
              }
            >
              <Button
                size="small"
                icon={<ThunderboltOutlined />}
                loading={building}
                disabled={buildDisabled}
                onClick={onBuild}
                style={{ marginInlineStart: 4 }}
              >
                {report.stale ? "Rebuild" : "Build"}
              </Button>
            </Tooltip>
          ) : null}
        </Space>
      )}
    </div>
  );
}


function MatrixTable({
  matrix,
  selected,
  switching,
  onSelect,
}: {
  matrix: DashboardData["matrix"];
  selected: string | null;
  /** A month switch is in flight: the chosen header spins, the rest wait. */
  switching: boolean;
  onSelect: (month: string) => void;
}) {
  const { token } = theme.useToken();

  type Row = { key: string; label: string; cells: ("yes" | "no" | "optional")[] };

  return (
    <Table<Row>
      dataSource={matrix.rows}
      rowKey="key"
      size="small"
      pagination={false}
      // Body rows dim like every other stale block; the one spinner for
      // "this is the month you asked for" already lives on its own column
      // header below, so the table doesn't also grow a second, whole-table
      // one on top of it.
      onRow={() => ({ style: staleStyle(switching) })}
      scroll={{ x: 320 + matrix.months.length * 92 }}
      columns={[
        {
          title: "",
          dataIndex: "label",
          fixed: "left",
          width: 210,
          render: (label: string) => (
            <Text style={{ fontSize: 12 }}>
              {label.replace("Amazon Monthly Transaction report", "Amazon")}
            </Text>
          ),
        },
        ...matrix.months.map((month, index) => ({
          title: (
            // A button, unmistakably: hover, border, press. A bare blue label
            // did not read as clickable.
            <Button
              size="small"
              shape="round"
              type={month === selected ? "primary" : "text"}
              loading={switching && month === selected}
              disabled={switching && month !== selected}
              onClick={() => onSelect(month)}
              style={{ fontSize: 12, fontWeight: month === selected ? 600 : 400 }}
            >
              {monthLabelShort(month)}
            </Button>
          ),
          key: month,
          width: 92,
          align: "center" as const,
          render: (_: unknown, row: Row) => {
            const cell = row.cells[index];

            if (cell === "yes") {
              return (
                <span style={{ display: "inline-flex", justifyContent: "center", width: "100%" }}>
                  <Dot color={token.colorSuccess} size={8} />
                </span>
              );
            }

            return (
              <Text type="secondary" style={{ opacity: cell === "optional" ? 0.35 : 0.7 }}>
                —
              </Text>
            );
          },
        })),
      ]}
    />
  );
}
