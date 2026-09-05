"use client";

import {
  CheckCircleFilled,
  CloudUploadOutlined,
  DownloadOutlined,
  EyeOutlined,
  DownOutlined,
  ExportOutlined,
  FileTextOutlined,
  InboxOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { App, Button, theme, Tooltip, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

import type { AuditRow } from "@/lib/audit/record";
import type {
  ChecklistItem,
  CloseReport,
  DashboardData,
  MatrixGroup,
} from "@/lib/dashboard/queries";
import { describePeriodLabel, monthLabelShort, monthLabelWords } from "@/lib/ingest/period";
import { republish } from "@/lib/reports/actions";
import type { DeadlineDashboardRow } from "@/lib/reports/deadlines-queries";

import { useDrivePreview } from "@/components/common/drive-preview";
import { useKindAccent } from "@/components/common/kind-accent";
import { targetKey, useBuildQueue } from "@/components/reports/build-queue";

import { MonthPicker } from "./month-picker";
import { staleStyle } from "./stale-style";

const { Text } = Typography;

/** Rows shown before the side cards offer the rest. */
const DEADLINES_PREVIEW = 3;
const ACTIVITY_PREVIEW = 6;

const ICON_BUTTON = { width: 26, height: 26 } as const;

/**
 * The row's own build control. `size="small"` alone would give it antd's
 * small metrics — 14px text in a 4px-radius box — next to icon buttons drawn
 * at 26 with a 6px radius, which is what makes one row look like two kits.
 */
const ROW_BUTTON = {
  height: 26,
  paddingInline: 10,
  fontSize: 13,
  marginInlineStart: 4,
} as const;

/**
 * The month as the accountant works it: which month, how far along, what needs
 * a person, and the two halves of the close — the files that came in and the
 * reports that go out — in one card rather than two.
 */
export function DashboardView({
  data,
  activity,
  flaggedRows,
  deadlines,
  driveConnected,
  canBuild,
  canEditSkuMappings,
  canEditCurrencyMappings,
  uploadAction,
}: {
  data: DashboardData;
  activity: AuditRow[];
  /** Current ledger rows waiting for a person, tenant-wide. */
  flaggedRows: number;
  /** Reports due for the month shown, already sorted. */
  deadlines: DeadlineDashboardRow[];
  /**
   * A Drive folder is chosen for this tenant. A built workbook with no Drive
   * link means something different when it is false — nothing is on its way.
   */
  driveConnected: boolean;
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
  const { startQueue, runningKey, queueTotal, queueDone, queueSource, busy, justBuilt, modals } =
    useBuildQueue({ canEditSkuMappings, canEditCurrencyMappings });

  // Switching months is a server round trip. Until the new page commits, the
  // month the user asked for is the one we show as chosen, with a spinner on
  // it — otherwise the click looks ignored and gets repeated.
  const [switching, startSwitch] = useTransition();
  const [requestedMonth, setRequestedMonth] = useState<string | null>(null);
  const shownMonth = switching && requestedMonth ? requestedMonth : data.month;

  const [filesExpanded, setFilesExpanded] = useState(false);
  const [filesFlash, setFilesFlash] = useState(false);
  const [deadlinesAll, setDeadlinesAll] = useState(false);
  const [activityAll, setActivityAll] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // The flash is a one-shot: the effect owns its timer so it is cleared if the
  // month switches or the page unmounts before it fires.
  useEffect(() => {
    if (!filesFlash) return;

    const timer = setTimeout(() => setFilesFlash(false), 900);

    return () => clearTimeout(timer);
  }, [filesFlash]);

  const goToMonth = (month: string) => {
    if (switching || month === data.month) return;

    setRequestedMonth(month);
    startSwitch(() => {
      router.push(`/dashboard?month=${encodeURIComponent(month)}`);
    });
  };

  const requiredItems = data.items.filter((item) => item.requirement === "required");
  const requiredIn = requiredItems.filter((item) => item.uploaded).length;
  const missing = requiredItems.filter((item) => !item.uploaded);
  const built = data.reports.filter((report) => report.state === "built" && !report.stale).length;
  const staleReports = data.reports.filter((report) => report.stale);
  const driveFailed = data.reports.reduce((total, report) => total + report.drive.failed, 0);
  const empty = data.months.length === 0;

  /**
   * The files section is where a missing file gets fixed, so everything that
   * mentions one leads here rather than to another screen: the section opens,
   * scrolls into view, and flashes once so the eye lands on it.
   */
  const revealFiles = useCallback(() => {
    setFilesExpanded(true);
    setFilesFlash(true);

    document.getElementById("dashboard-files")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const targetsFor = (reports: CloseReport[]) => {
    const period = data.month;

    if (!period) return [];

    return reports.map((report) => ({
      reportType: report.id,
      periodLabel: period,
      label: `${report.label} · ${period}`,
    }));
  };

  // The same shortlist the server counted for `data.buildable`: never built,
  // or built before a re-upload made the run stale.
  //
  // Tagged "all" so this button shows its own progress and not a row's: both
  // feed the same one-at-a-time queue, and the shortcut greying out for one
  // report's build made the whole screen look busy.
  const buildAll = () =>
    startQueue(
      targetsFor(data.reports.filter((report) => report.state === "ready" || report.stale)),
      "all",
    );

  // What actually needs a person, each carrying the thing that fixes it.
  // Order: by how wrong it is to ignore.
  const alerts: AlertItem[] = [];

  if (flaggedRows > 0) {
    alerts.push({
      key: "flagged",
      // Every current row waiting for a person, in any month — the one chip
      // here that is not about the month on screen, so it says so rather than
      // reading as a count for it.
      text: `${flaggedRows} unreadable row${flaggedRows === 1 ? "" : "s"}`,
      detail: "across all months",
      href: "/source-files",
    });
  }
  if (missing.length > 0) {
    alerts.push({
      key: "missing",
      text: `${missing.length} required file${missing.length === 1 ? "" : "s"} missing`,
      detail: missing.map((item) => shortLabel(item.label)).join(", "),
      act: revealFiles,
    });
  }
  if (staleReports.length > 0) {
    alerts.push({
      key: "stale",
      text: `${staleReports.length} report${staleReports.length === 1 ? " is" : "s are"} stale`,
      detail: staleReports.map((report) => shortLabel(report.label)).join(", "),
      act: canBuild ? () => startQueue(targetsFor(staleReports)) : undefined,
    });
  }
  if (driveFailed > 0) {
    alerts.push({
      key: "drive",
      text: `Drive delivery failed for ${driveFailed} file${driveFailed === 1 ? "" : "s"}`,
      detail: "retry on Reports",
      href: "/reports",
    });
  }

  const dim = staleStyle(switching);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <PeriodBar
          months={data.months}
          shownMonth={shownMonth}
          currentMonth={data.currentMonth}
          switching={switching}
          onSelectMonth={goToMonth}
          files={{ done: requiredIn, total: requiredItems.length }}
          reports={{ done: built, total: data.reports.length }}
          uploadAction={uploadAction}
          buildAction={
            canBuild && !empty ? (
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
                  loading={queueSource === "all"}
                  disabled={data.buildable === 0}
                  onClick={buildAll}
                >
                  {queueSource === "all" && queueTotal > 1
                    ? `Building ${queueDone + 1} of ${queueTotal}…`
                    : data.buildable === 0
                      ? "All built"
                      : `Build ${data.buildable} report${data.buildable === 1 ? "" : "s"}`}
                </Button>
              </Tooltip>
            ) : null
          }
        />

        {empty ? (
          <Panel className="ea-rise ea-rise-1">
            <div style={{ padding: "16px 14px" }}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                Nothing uploaded yet. Press Upload files above and drop a month&apos;s exports — the
                month appears here the moment the first file lands.
              </Text>
            </div>
          </Panel>
        ) : null}

        {alerts.length > 0 ? (
          <Panel className="ea-rise ea-rise-1" style={dim}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
                padding: "10px 14px",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  flex: "none",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <WarningOutlined style={{ fontSize: 15, color: token.colorWarning }} />
                Needs you
              </span>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  minWidth: 0,
                }}
              >
                {alerts.map((alert) => (
                  <AlertChip key={alert.key} alert={alert} />
                ))}
              </div>
            </div>
          </Panel>
        ) : null}

        {empty ? null : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "stretch" }}>
            <Panel
              className="ea-rise ea-rise-1"
              id="dashboard-reports"
              style={{ flex: "2 1 520px", minWidth: 0 }}
            >
              <PanelHeader
                title="Month close"
                extra={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    In progress
                  </Text>
                }
              />

              <div
                id="dashboard-files"
                style={{
                  padding: "12px 14px",
                  borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  background: filesFlash ? token.colorPrimaryBg : "transparent",
                  transition: "background 400ms ease",
                  scrollMarginTop: 72,
                  ...dim,
                }}
              >
                <FilesSection
                  items={data.items}
                  missing={missing}
                  expanded={filesExpanded}
                  onToggle={() => setFilesExpanded((open) => !open)}
                />
              </div>

              <div style={{ padding: "4px 14px 8px", ...dim }}>
                {data.reports.map((report) => {
                  const key = data.month
                    ? targetKey({ reportType: report.id, periodLabel: data.month, label: "" })
                    : null;

                  return (
                    <ReportRow
                      key={report.id}
                      report={report}
                      canBuild={canBuild}
                      driveConnected={driveConnected}
                      building={key !== null && runningKey === key}
                      buildDisabled={busy && runningKey !== key}
                      // The only thing this month is waiting to be built, so
                      // its own button is the obvious next move rather than
                      // one plain button among several.
                      soleBuild={data.buildable === 1}
                      justBuilt={key !== null && justBuilt.has(key)}
                      onBuild={() => startQueue(targetsFor([report]))}
                    />
                  );
                })}
              </div>
            </Panel>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                flex: "1 1 320px",
                minWidth: 0,
              }}
            >
              <Panel className="ea-rise ea-rise-2" style={dim}>
                <PanelHeader
                  title="Deadlines"
                  extra={
                    deadlines.length > DEADLINES_PREVIEW ? (
                      <LinkButton onClick={() => setDeadlinesAll((all) => !all)}>
                        {deadlinesAll ? "Show less" : `All ${deadlines.length}`}
                      </LinkButton>
                    ) : null
                  }
                />
                <div style={{ padding: "6px 14px 10px" }}>
                  {deadlines.length === 0 ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {shownMonth
                        ? `Nothing due for ${monthLabelWords(shownMonth)}.`
                        : "No month selected yet."}
                    </Text>
                  ) : (
                    (deadlinesAll ? deadlines : deadlines.slice(0, DEADLINES_PREVIEW)).map((row) => (
                      <DeadlineRow key={row.key} row={row} month={shownMonth} />
                    ))
                  )}
                </div>
              </Panel>

              {activity.length > 0 ? (
                // Takes up the slack in the column, so its lower edge meets
                // Month close's rather than stopping short of it.
                <Panel className="ea-rise ea-rise-3" style={{ flex: "1 1 auto" }}>
                  <PanelHeader
                    title="Activity"
                    extra={
                      activity.length > ACTIVITY_PREVIEW ? (
                        <LinkButton onClick={() => setActivityAll((all) => !all)}>
                          {activityAll ? "Show less" : `All ${activity.length}`}
                        </LinkButton>
                      ) : null
                    }
                  />
                  <div
                    style={{
                      padding: "10px 14px 12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 7,
                    }}
                  >
                    {(activityAll ? activity : activity.slice(0, ACTIVITY_PREVIEW)).map((row) => (
                      <ActivityRow key={row.id} row={row} />
                    ))}

                    {/*
                      "All 10" in the header expands the ten rows the page
                      fetched, which is not the whole log. The log lives on
                      Settings, and this is the only way back to it.
                    */}
                    <Link href="/settings?tab=activity" style={{ fontSize: 12, marginTop: 3 }}>
                      Full activity log
                    </Link>
                  </div>
                </Panel>
              ) : null}
            </div>
          </div>
        )}

        {empty ? null : (
          <Panel className="ea-rise ea-rise-3" style={dim}>
            <HistorySection
              matrix={data.matrix}
              open={historyOpen}
              onToggle={() => setHistoryOpen((open) => !open)}
            />
          </Panel>
        )}
      </div>
      <BuiltAnimation />
      {modals}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Surfaces
 * ------------------------------------------------------------------ */

/**
 * A plain bordered surface. antd's `Card` brings a header of its own and a
 * body padding this screen overrides in every section; what would be left of
 * it is the border and the radius, so those are all this draws.
 */
function Panel({
  children,
  className,
  id,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
}) {
  const { token } = theme.useToken();

  return (
    <section
      id={id}
      className={className}
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

function PanelHeader({ title, extra }: { title: string; extra?: React.ReactNode }) {
  const { token } = theme.useToken();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        minHeight: 38,
        padding: "0 14px",
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
      {extra}
    </div>
  );
}

function LinkButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <Button
      type="link"
      size="small"
      style={{ padding: 0, height: "auto", fontSize: 12 }}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/* ------------------------------------------------------------------ *
 * a. The period bar
 * ------------------------------------------------------------------ */

function PeriodBar({
  months,
  shownMonth,
  currentMonth,
  switching,
  onSelectMonth,
  files,
  reports,
  uploadAction,
  buildAction,
}: {
  months: string[];
  shownMonth: string | null;
  /** The month being closed — what the shortcut goes back to. */
  currentMonth: string | null;
  switching: boolean;
  onSelectMonth: (month: string) => void;
  files: { done: number; total: number };
  reports: { done: number; total: number };
  uploadAction: React.ReactNode;
  buildAction: React.ReactNode;
}) {
  const { token } = theme.useToken();

  return (
    <section
      className="ea-rise"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: "16px 24px",
        padding: "2px 2px 0",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: token.colorTextTertiary,
            marginBottom: 6,
          }}
        >
          {/* Which month this is, not what the screen is for. "Current" is the
              month being closed — July through August — not the calendar month,
              because that is the one the work is actually about. */}
          {shownMonth !== null && shownMonth === currentMonth ? "Current month" : "Month overview"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <MonthPicker
            bare
            months={months}
            value={shownMonth}
            loading={switching}
            disabled={switching}
            onChange={onSelectMonth}
          />
          {/* Stepping back a few months is two clicks; getting back is one.
              Absent while it is already showing, so the bar never offers a
              move that would do nothing. */}
          {currentMonth && shownMonth !== currentMonth && months.includes(currentMonth) ? (
            <Button
              size="small"
              type="text"
              disabled={switching}
              onClick={() => onSelectMonth(currentMonth)}
              style={{ fontSize: 12.5, color: token.colorPrimary }}
            >
              Current month
            </Button>
          ) : null}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 28,
          flexWrap: "wrap",
          flex: "1 1 auto",
          minWidth: 0,
          ...staleStyle(switching),
        }}
      >
        <Meter label="Required files" done={files.done} total={files.total} />
        <Meter label="Reports built" done={reports.done} total={reports.total} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
        {uploadAction}
        {buildAction}
      </div>
    </section>
  );
}

/**
 * A count and the bar under it. Primary while there is work left, success only
 * once the count is complete — a green bar at 11 of 13 would say the month is
 * done when it is not.
 */
function Meter({ label, done, total }: { label: string; done: number; total: number }) {
  const { token } = theme.useToken();
  const complete = total > 0 && done === total;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div style={{ minWidth: 150 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 12,
          color: token.colorTextSecondary,
          marginBottom: 6,
        }}
      >
        <span>{label}</span>
        <span
          style={{ color: token.colorText, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
        >
          {done}/{total}
        </span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: token.colorFillSecondary,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            borderRadius: 3,
            width: `${percent}%`,
            background: complete ? token.colorSuccess : token.colorPrimary,
            transition: "width 300ms ease",
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * b. The "needs you" strip
 * ------------------------------------------------------------------ */

type AlertItem = {
  key: string;
  text: string;
  detail?: string;
  href?: string;
  act?: () => void;
};

function AlertChip({ alert }: { alert: AlertItem }) {
  const { token } = theme.useToken();
  const [hover, setHover] = useState(false);
  const interactive = Boolean(alert.href || alert.act);

  const body = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 26,
        padding: "0 10px",
        borderRadius: 13,
        background: hover && interactive ? token.colorPrimaryBg : token.colorFillTertiary,
        color: hover && interactive ? token.colorPrimary : token.colorText,
        fontSize: 12.5,
        cursor: interactive ? "pointer" : "default",
        transition: "background 150ms ease, color 150ms ease",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {alert.text}
      {alert.detail ? (
        <span style={{ color: hover && interactive ? token.colorPrimary : token.colorTextTertiary }}>
          {alert.detail}
        </span>
      ) : null}
    </span>
  );

  if (alert.href) return <Link href={alert.href}>{body}</Link>;

  if (alert.act) {
    const act = alert.act;

    return (
      <span
        role="button"
        tabIndex={0}
        onClick={act}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            act();
          }
        }}
      >
        {body}
      </span>
    );
  }

  return body;
}

/* ------------------------------------------------------------------ *
 * c. Files and reports
 * ------------------------------------------------------------------ */

function FilesSection({
  items,
  missing,
  expanded,
  onToggle,
}: {
  items: ChecklistItem[];
  missing: ChecklistItem[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const { token } = theme.useToken();
  const required = items.filter((item) => item.requirement === "required");
  // A missing file already has a chip on the summary line. Expanding reveals
  // what is *not* up there — otherwise the same file appears twice, once in
  // each row, and reads as two files of the same name.
  const onShow = new Set(missing.map((item) => item.key));
  const rest = items.filter((item) => !onShow.has(item.key));
  // Nothing left to reveal — every file this month wants is already a chip on
  // the line above, which is what a month where all of them are required and
  // none has arrived looks like. The button was still there, and opened an
  // empty space.
  const canExpand = rest.length > 0;

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 9,
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          {missing.length === 0 ? (
            <>
              <CheckCircleFilled style={{ fontSize: 14, color: token.colorSuccess }} />
              <span style={{ fontSize: 13 }}>All {required.length} required files uploaded.</span>
            </>
          ) : (
            <>
              <WarningOutlined style={{ fontSize: 14, color: token.colorWarning }} />
              <span style={{ fontSize: 13 }}>
                {missing.length} of {required.length} required files still missing.
              </span>
              {missing.map((item) => (
                <FileChip key={item.key} item={item} />
              ))}
            </>
          )}
        </span>

        {canExpand ? (
          <Button
            type="text"
            size="small"
            onClick={onToggle}
            style={{ flex: "none", fontSize: 12.5, color: token.colorTextTertiary }}
            icon={
              <DownOutlined
                style={{
                  fontSize: 10,
                  transition: "transform 150ms ease",
                  transform: expanded ? "rotate(180deg)" : undefined,
                }}
              />
            }
            iconPosition="end"
          >
            {expanded ? "Hide" : "All files"}
          </Button>
        ) : null}
      </div>

      {expanded && canExpand ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {rest.map((item) => (
            <FileChip key={item.key} item={item} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function FileChip({ item }: { item: ChecklistItem }) {
  const { token } = theme.useToken();
  const optionalAbsent = !item.uploaded && item.requirement === "optional";

  return (
    <Tooltip
      title={
        item.uploaded
          ? `${item.filename}${item.rows !== null ? ` · ${item.rows} rows` : ""}`
          : optionalAbsent
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
          background: token.colorFillTertiary,
          fontSize: 12,
          color: item.uploaded
            ? token.colorText
            : optionalAbsent
              ? token.colorTextTertiary
              : token.colorTextSecondary,
          cursor: "default",
        }}
      >
        <Dot
          color={
            item.uploaded
              ? token.colorSuccess
              : optionalAbsent
                ? token.colorTextQuaternary
                : token.colorWarning
          }
        />
        {shortLabel(item.label)}
      </span>
    </Tooltip>
  );
}

/**
 * One report, one status, and a second line saying what actually happened to
 * it — when it was built, whether it reached Drive, what it is waiting for.
 *
 * A stale report gets no rebuild button of its own on purpose: the month's own
 * Build covers it, and offering the same run two ways invites building twice.
 */
function ReportRow({
  report,
  canBuild,
  driveConnected,
  building,
  buildDisabled,
  soleBuild,
  justBuilt,
  onBuild,
}: {
  report: CloseReport;
  canBuild: boolean;
  /** A Drive folder is chosen, so a missing link means "on its way". */
  driveConnected: boolean;
  /** This report is the one the queue is building right now. */
  building: boolean;
  /** Something else is building: this row's button waits its turn. */
  buildDisabled: boolean;
  /** True when this is the month's only buildable report. */
  soleBuild: boolean;
  /** This queue has just built it, so the row can say which one changed. */
  justBuilt: boolean;
  onBuild: () => void;
}) {
  const { token } = theme.useToken();
  const router = useRouter();
  const { message } = App.useApp();
  const preview = useDrivePreview(report.artifact?.driveUrl, report.label);
  const [sending, startSending] = useTransition();

  const waiting = report.state === "waiting";
  const dot = report.stale
    ? token.colorWarning
    : report.state === "built"
      ? token.colorSuccess
      : report.state === "ready"
        ? token.colorPrimary
        : token.colorTextQuaternary;

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
        gap: 12,
        justifyContent: "space-between",
        padding: "9px 0",
        borderBottom: `1px solid ${token.colorFillQuaternary}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
        <span style={{ marginTop: 6 }}>
          <Dot color={dot} celebrate={justBuilt} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: waiting ? 400 : 500,
                color: waiting ? token.colorTextSecondary : token.colorText,
              }}
            >
              {report.label}
            </span>
            {report.warnings > 0 ? (
              <Tooltip title="Open Reports and expand the run to read them.">
                <WarningOutlined style={{ fontSize: 12.5, color: token.colorWarning }} />
              </Tooltip>
            ) : null}
          </div>
          <div style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
            {reportMeta(report, driveConnected)}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 2, flex: "none" }}>
        {waiting ? null : (
          <>
            {report.artifact?.driveUrl ? (
              <Tooltip title="Look at the workbook without leaving this screen.">
                <Button
                  type="text"
                  icon={<EyeOutlined />}
                  onClick={preview.open}
                  aria-label={`Preview ${report.label}`}
                  style={ICON_BUTTON}
                />
              </Tooltip>
            ) : null}

            {report.artifact?.driveUrl ? (
              <Tooltip title="Open in Google Drive — the whole table, with Sheets' own sorting and search.">
                <Button
                  type="text"
                  icon={<ExportOutlined />}
                  href={report.artifact.driveUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${report.label} in Drive`}
                  style={ICON_BUTTON}
                />
              </Tooltip>
            ) : driveConnected && report.artifact && report.runId ? (
              <Tooltip title="Not in Drive yet — send it now.">
                <Button
                  type="text"
                  icon={<CloudUploadOutlined />}
                  loading={sending}
                  onClick={sendToDrive}
                  aria-label={`Send ${report.label} to Drive`}
                  style={ICON_BUTTON}
                />
              </Tooltip>
            ) : null}

            {report.artifact ? (
              <Tooltip title="Download the workbook this run produced.">
                <Button
                  type="text"
                  icon={<DownloadOutlined />}
                  href={`/api/reports/${report.artifact.id}`}
                  download={report.artifact.filename}
                  aria-label={`Download ${report.label}`}
                  style={ICON_BUTTON}
                />
              </Tooltip>
            ) : null}

            {canBuild && (report.state === "ready" || report.stale) ? (
              <Tooltip
                title={
                  report.stale
                    ? "Runs it again on the files as they stand now. The old run stays on Reports."
                    : "Builds this report alone. The run is recorded with the rules and rates it used."
                }
              >
                <Button
                  size="small"
                  // Primary only when it is the single thing left to do: with
                  // several rows offering a build, colouring them all makes
                  // none of them the next step.
                  type={soleBuild ? "primary" : "default"}
                  loading={building}
                  disabled={buildDisabled}
                  onClick={onBuild}
                  style={{ ...ROW_BUTTON, borderRadius: token.borderRadius }}
                >
                  {report.stale ? "Rebuild" : "Build"}
                </Button>
              </Tooltip>
            ) : null}
          </>
        )}
      </div>

      {preview.modal}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * d. Deadlines and activity
 * ------------------------------------------------------------------ */

function DeadlineRow({ row, month }: { row: DeadlineDashboardRow; month: string | null }) {
  const { token } = theme.useToken();
  const done = row.state.kind === "completed";

  const shown =
    row.state.kind === "completed"
      ? { color: token.colorSuccess, text: "Done" }
      : row.state.kind === "overdue"
        ? { color: token.colorError, text: `${row.state.days}d late` }
        : row.state.kind === "due_today"
          ? { color: token.colorWarning, text: "Due today" }
          : row.state.kind === "due_tomorrow"
            ? { color: token.colorWarning, text: "Tomorrow" }
            : {
                color: row.state.days <= 3 ? token.colorWarning : token.colorTextQuaternary,
                text: `In ${row.state.days}d`,
              };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        padding: "7px 0",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: done ? token.colorTextSecondary : token.colorText,
          }}
        >
          {row.label}
        </div>
        <div style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
          {/* The period is named only when it is not the month the screen is
              already on: at a month end a quarterly deadline stands beside the
              monthly ones and is otherwise indistinguishable from them. */}
          {row.periodLabel === month
            ? null
            : `${describePeriodLabel(row.periodLabel, row.granularity)} · `}
          due {formatDeadline(row.deadline)}
        </div>
      </div>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
        <Dot color={shown.color} />
        <span style={{ fontSize: 11.5, fontWeight: 500, color: shown.color }}>{shown.text}</span>
      </span>
    </div>
  );
}

function ActivityRow({ row }: { row: AuditRow }) {
  const { token } = theme.useToken();

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <Dot color={activityTone(row.action, token)} size={6} />
      <span style={{ fontSize: 12, color: token.colorTextTertiary, minWidth: 78 }}>
        {new Date(row.createdAt).toLocaleString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
      <span style={{ fontSize: 12 }}>{row.action}</span>
      <span
        style={{
          fontSize: 12,
          color: token.colorTextTertiary,
          marginInlineStart: "auto",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {/* The name, because that is who a colleague recognises. The address
            stays reachable on hover: two people can share a first name, and
            the log is a record of who did what. */}
        <Tooltip title={row.userEmail ?? undefined}>
          <span>{row.userName ?? row.userEmail ?? ""}</span>
        </Tooltip>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * e. History
 * ------------------------------------------------------------------ */

function HistorySection({
  matrix,
  open,
  onToggle,
}: {
  matrix: DashboardData["matrix"];
  open: boolean;
  onToggle: () => void;
}) {
  const { token } = theme.useToken();
  const [hover, setHover] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          minHeight: 38,
          padding: "0 14px",
          border: "none",
          background: hover ? token.colorFillQuaternary : "transparent",
          borderRadius: token.borderRadiusLG,
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
          transition: "background 150ms ease",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: token.colorText }}>History</span>
          <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
            {matrix.months.length} month{matrix.months.length === 1 ? "" : "s"} · source files and
            reports
          </span>
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12.5,
            color: token.colorTextTertiary,
          }}
        >
          {open ? "Hide" : "Show"}
          <DownOutlined
            style={{
              fontSize: 10,
              transition: "transform 150ms ease",
              transform: open ? "rotate(180deg)" : undefined,
            }}
          />
        </span>
      </button>

      {open ? (
        <div
          style={{ padding: "12px 14px 14px", borderTop: `1px solid ${token.colorBorderSecondary}` }}
        >
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 1180, fontSize: 12 }}>
              <div
                style={{ display: "flex", borderBottom: `1px solid ${token.colorBorderSecondary}` }}
              >
                <div style={{ width: 210, flex: "none", padding: "6px 8px" }} />
                {matrix.months.map((month) => (
                  <div
                    key={month}
                    style={{
                      width: 74,
                      flex: "none",
                      padding: "6px 4px",
                      textAlign: "center",
                      fontSize: 11.5,
                      color: token.colorTextTertiary,
                    }}
                  >
                    {monthLabelShort(month)}
                  </div>
                ))}
              </div>

              {matrix.groups.map((group) => (
                <HistoryGroup key={group.key} group={group} />
              ))}
            </div>
          </div>

          <p style={{ fontSize: 12, color: token.colorTextTertiary, margin: "10px 0 0" }}>
            A dot is there, a dash is not — green for a file that arrived, blue for a report that
            was built.
          </p>
        </div>
      ) : null}
    </>
  );
}

function HistoryGroup({ group }: { group: MatrixGroup }) {
  const { token } = theme.useToken();
  const { accent, tint } = useKindAccent(group.kind);
  const dotColour = group.kind === "upload" ? token.colorSuccess : token.colorPrimary;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 8px 6px",
          background: tint,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 20,
            height: 20,
            borderRadius: token.borderRadius,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            fontSize: 11,
            background: token.colorBgContainer,
            color: accent,
          }}
        >
          {group.kind === "upload" ? <InboxOutlined /> : <FileTextOutlined />}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: accent,
          }}
        >
          {group.label}
        </span>
        <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
          {group.kind === "upload"
            ? "a dot is a file that arrived"
            : "a dot is a report that was built"}
        </span>
      </div>

      {group.rows.map((row) => (
        <div key={row.key} style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: 210,
              flex: "none",
              padding: "6px 8px 6px 16px",
              fontSize: 12,
              color: token.colorTextSecondary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {shortLabel(row.label)}
          </div>
          {row.cells.map((cell, index) => (
            <div
              key={`${row.key}:${index}`}
              style={{
                width: 74,
                flex: "none",
                padding: "6px 4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {cell === "yes" ? (
                <span
                  style={{ width: 8, height: 8, borderRadius: 999, background: dotColour }}
                />
              ) : (
                <span
                  style={{
                    width: 8,
                    height: 1,
                    background: token.colorTextQuaternary,
                    opacity: cell === "optional" ? 0.35 : 0.8,
                  }}
                />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Small shared pieces
 * ------------------------------------------------------------------ */

function Dot({
  color,
  size = 7,
  celebrate = false,
}: {
  color: string;
  size?: number;
  /** Just built: the marker arrives with a ring rather than simply being green. */
  celebrate?: boolean;
}) {
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
        // One ring outward, once. Enough to tell the eye which row changed
        // among five that look alike; short enough not to become scenery.
        animation: celebrate ? "ea-built 700ms ease-out" : undefined,
      }}
    />
  );
}

/**
 * The one keyframe this screen uses.
 *
 * Inline rather than in a stylesheet because it belongs to the row it
 * animates, and honours the reader's own setting: somebody who has asked for
 * less motion gets the colour change and nothing else.
 */
function BuiltAnimation() {
  return (
    <style>{`
      @keyframes ea-built {
        0% { box-shadow: 0 0 0 0 currentColor; transform: scale(1); }
        35% { transform: scale(1.55); }
        100% { box-shadow: 0 0 0 7px transparent; transform: scale(1); }
      }
      @media (prefers-reduced-motion: reduce) {
        @keyframes ea-built { from { transform: none; } to { transform: none; } }
      }
    `}</style>
  );
}

/** Colour by what the action did, not by which table it touched. */
function activityTone(
  action: string,
  token: {
    colorError: string;
    colorPrimary: string;
    colorSuccess: string;
    colorTextQuaternary: string;
  },
): string {
  if (action.endsWith(".deleted") || action.endsWith(".failed") || action.endsWith(".suspended")) {
    return token.colorError;
  }
  if (action.startsWith("report.")) return token.colorPrimary;
  if (action.startsWith("upload.")) return token.colorSuccess;

  return token.colorTextQuaternary;
}

/** The full dataset name is the same word repeated down a 210px column. */
function shortLabel(label: string): string {
  return label.replace("Amazon Monthly Transaction report", "Amazon");
}

function shortDateTime(value: Date): string {
  const date = new Date(value);

  return `${date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

function formatDeadline(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The second line of a report row: what happened to it, not what it is. The
 * states are mutually exclusive on purpose — a row saying three things at once
 * is the noise this line replaced.
 */
function reportMeta(report: CloseReport, driveConnected: boolean): string {
  if (report.state === "waiting") {
    if (report.missing.length === 0) return "Waiting for files";

    const named = report.missing.slice(0, 3).map(shortLabel).join(", ");

    return `Waiting for ${named}${report.missing.length > 3 ? ` +${report.missing.length - 3}` : ""}`;
  }

  if (report.state === "ready") {
    return report.lastFailure
      ? `The last attempt failed: ${report.lastFailure}`
      : "Everything it needs is in — ready to build";
  }

  const when = report.builtAt ? shortDateTime(report.builtAt) : "earlier";

  if (report.stale) return `Built ${when} · a file it used has been replaced since`;

  const parts = [`Built ${when}`];

  if (report.warnings > 0) {
    parts.push(`${report.warnings} warning${report.warnings === 1 ? "" : "s"}`);
  }

  // "yet" is a promise, and it holds only when there is a Drive for the file
  // to arrive in. With no folder connected the workbook is not late — it was
  // never going anywhere, and saying so is what makes the download the answer.
  parts.push(
    report.artifact?.driveUrl ? "in Drive" : driveConnected ? "not in Drive yet" : "download only",
  );

  return parts.join(" · ");
}
