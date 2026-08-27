"use client";

import { DownloadOutlined, ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, App, Button, Empty, Space, Tag, theme, Tooltip, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { restoreDefaults } from "@/lib/reference/actions";
import { REPORT_DEFINITIONS, type ReportTypeId } from "@/lib/reports/definitions";
import type { ReportAvailability, ReportPeriodRow } from "@/lib/reports/queries";

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
  missingRules,
  canBuild,
  canRestore,
  canEditSkuMappings,
  canEditCurrencyMappings,
}: {
  periods: Record<ReportTypeId, ReportAvailability>;
  periodRows: Record<ReportTypeId, ReportPeriodRow[]>;
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
            <Typography.Title level={5} style={{ margin: 0 }}>
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
      <span style={{ width: 150, fontSize: 13.5, fontWeight: 500, flex: "none" }}>{row.period}</span>
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
