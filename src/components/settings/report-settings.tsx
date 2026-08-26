"use client";

import { CheckOutlined, InfoCircleOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Collapse,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useState, type CSSProperties } from "react";

import type { PeriodGranularity } from "@/lib/db/schema";
import type { DeadlineRuleRow } from "@/lib/reports/deadlines-queries";
import { saveDeadlineRule, type DeadlineActionResult } from "@/lib/reports/deadlines-actions";
import { MONTHS } from "@/lib/ingest/months";
import type { PeriodSchedule } from "@/lib/periods/schedule";
import { REPORT_DEFINITIONS, type ReportDefinition, type ReportTypeId } from "@/lib/reports/definitions";
import type { AllReportSettings, Requirement } from "@/lib/reports/settings";
import { DATASET_NAMES } from "@/modules/channels/registry";
import {
  saveReportSettings,
  saveReportStartDate,
  type SettingsActionResult,
} from "@/lib/reports/settings-actions";
import { ZOHO_COUNTRIES } from "@/modules/reports/amazon-zoho-invoice";

type Runner = (action: () => Promise<SettingsActionResult | DeadlineActionResult>) => void;

const THIS_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 9 }, (_, index) => THIS_YEAR + 1 - index);
const GRANULARITIES: PeriodGranularity[] = ["month", "quarter", "year"];

const FACT_CHIP_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  height: 22,
  padding: "0 9px",
  borderRadius: 999,
  border: "1px solid var(--ant-color-split)",
  background: "var(--ant-color-fill-tertiary)",
  fontSize: 11.5,
  color: "var(--ant-color-text-secondary)",
};

const FACT_CHIP_DUE_STYLE: CSSProperties = {
  color: "var(--ant-color-text-tertiary)",
  fontFamily: "var(--font-geist-mono, monospace)",
  fontSize: 10.5,
};

function monthLabel(startsFrom: string): string {
  const [year, month] = startsFrom.split("-");

  return `${MONTHS[Number(month) - 1]?.fullName ?? month} ${year}`;
}

function ordinal(day: number): string {
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";

  return `${day}${suffix}`;
}

/** "due 5th" for a month/quarter rule, "due Jan 5th" for a yearly one. */
function dueLabel(granularity: PeriodGranularity, rule: DeadlineRuleRow["rule"] | undefined): string | null {
  if (!rule) return null;

  return granularity === "year"
    ? `due ${MONTHS[(rule.month ?? 1) - 1]?.fullName.slice(0, 3) ?? ""} ${ordinal(rule.day)}`
    : `due ${ordinal(rule.day)}`;
}

/**
 * The due-day input, typed at without saving on every keystroke: a two-digit
 * day used to save after its first digit, which both fired premature writes
 * and — since the value shown afterward is always whatever last actually
 * reached the server — made an unrelated save elsewhere (e.g. toggling a
 * channel optional, which reloads this whole tab) look like it had reset the
 * day back to the default. Typing now only stages a local draft; a save
 * fires on blur, Enter, or the confirm button that appears while the draft
 * differs from what is saved.
 */
function DeadlineDayField({
  day,
  disabled,
  onCommit,
}: {
  day: number | undefined;
  disabled: boolean;
  onCommit: (day: number) => void;
}) {
  // Reset when `day` itself changes — a successful save or a fresh load —
  // by remounting on a key that includes it, rather than syncing via effect.
  const [draft, setDraft] = useState<number | null>(day ?? null);

  const dirty = draft !== null && draft !== day;

  const commit = () => {
    if (draft !== null && draft !== day) onCommit(draft);
  };

  return (
    <Space.Compact>
      <InputNumber
        size="small"
        min={1}
        max={31}
        style={{ width: 64 }}
        disabled={disabled}
        value={draft ?? undefined}
        onChange={(value) => setDraft(typeof value === "number" ? value : null)}
        onPressEnter={commit}
        onBlur={commit}
      />
      {dirty ? (
        <Button
          size="small"
          type="primary"
          icon={<CheckOutlined />}
          onClick={commit}
          aria-label="Confirm due day"
        />
      ) : null}
    </Space.Compact>
  );
}

/**
 * The client's own description of how their reporting works: which reports
 * exist, what each one insists on before it will build, and when it falls
 * due. Long explanations live behind the (i) icons rather than as standing
 * paragraphs, and the detailed controls collapse behind "Configure" — the
 * fields and the server actions underneath are unchanged either way.
 */
export function ReportSettingsTab({
  settings,
  schedule,
  deadlineRules,
  canEdit,
  canEditDeadlines,
  run,
  pending,
}: {
  settings: AllReportSettings;
  /** Only to warn when a report is prepared for a period nobody opens. */
  schedule: PeriodSchedule;
  deadlineRules: DeadlineRuleRow[];
  canEdit: boolean;
  /** Owner or accountant — deadlines are a filing detail, not a company setting. */
  canEditDeadlines: boolean;
  run: Runner;
  pending: boolean;
}) {
  const save = (
    reportType: ReportTypeId,
    next: {
      enabled: boolean;
      optionalDatasets: string[];
      optionalCountries: string[];
      disabledGranularities: string[];
    },
  ) => {
    run(() => saveReportSettings({ reportType, ...next }));
  };

  const saveDeadline = (reportType: ReportTypeId, granularity: PeriodGranularity, day: number, month: number | null) => {
    run(() => saveDeadlineRule({ reportType, granularity, day, month }));
  };

  const optionalOf = (record: Record<string, Requirement>) =>
    Object.entries(record)
      .filter(([, requirement]) => requirement === "optional")
      .map(([key]) => key);

  const disabledOf = (record: Record<string, boolean>) =>
    Object.entries(record)
      .filter(([, on]) => !on)
      .map(([key]) => key);

  const deadlinesByReport = new Map<string, Map<PeriodGranularity, DeadlineRuleRow>>();

  for (const rule of deadlineRules) {
    const byGranularity = deadlinesByReport.get(rule.reportType) ?? new Map();

    byGranularity.set(rule.granularity, rule);
    deadlinesByReport.set(rule.reportType, byGranularity);
  }

  const [startDateModal, setStartDateModal] = useState<{
    definition: ReportDefinition;
    month: number;
    year: number;
  } | null>(null);

  const openStartDateModal = (definition: ReportDefinition, current: string | null) => {
    const [year, month] = current ? current.split("-").map(Number) : [THIS_YEAR, new Date().getMonth() + 1];

    setStartDateModal({ definition, month, year });
  };

  const saveStartDate = (startsFrom: string | null) => {
    if (!startDateModal) return;

    const { definition } = startDateModal;

    run(() => saveReportStartDate({ reportType: definition.id, startsFrom }));
    setStartDateModal(null);
  };

  return (
    <>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        {REPORT_DEFINITIONS.map((definition) => {
          const current = settings[definition.id];
          const optionalDatasets = optionalOf(current.datasets);
          const optionalCountries = optionalOf(current.countries);
          const disabledGranularities = disabledOf(current.granularities);
          const deadlines = deadlinesByReport.get(definition.id);
          // A report prepared for a period the tenant never opens is a card that
          // will never appear, with nothing on this page to explain why.
          const orphaned = definition.granularity.filter(
            (granularity) => current.granularities[granularity] !== false && !schedule[granularity],
          );
          const everythingOptional =
            definition.id === "off_amazon_sales" && optionalDatasets.length === definition.datasets.length;
          const preparedGranularities = definition.granularity.filter(
            (granularity) => current.granularities[granularity] !== false,
          );

          return (
            <Card
              key={definition.id}
              size="small"
              title={
                <Space size={8}>
                  <span>{definition.label}</span>
                  <Tooltip title={definition.description}>
                    <InfoCircleOutlined style={{ color: "var(--ant-color-text-tertiary)", cursor: "help" }} />
                  </Tooltip>
                </Space>
              }
              extra={
                <Space size={8}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {current.enabled ? "On" : "Off"}
                  </Typography.Text>
                  <Switch
                    checked={current.enabled}
                    disabled={!canEdit || pending}
                    aria-label={`${definition.label} on or off`}
                    onChange={(enabled) =>
                      save(definition.id, { enabled, optionalDatasets, optionalCountries, disabledGranularities })
                    }
                  />
                </Space>
              }
            >
              {!current.enabled ? (
                <Typography.Text type="secondary">
                  Hidden from Reports and refuses to build. Nothing else changes — uploads for its
                  channels are still accepted and kept.
                </Typography.Text>
              ) : (
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                  <Space size={6} wrap>
                    {preparedGranularities.map((granularity) => {
                      const due = dueLabel(granularity, deadlines?.get(granularity)?.rule);

                      return (
                        <span key={granularity} style={FACT_CHIP_STYLE}>
                          <span style={{ textTransform: "capitalize" }}>{granularity}</span>
                          {due ? <span style={FACT_CHIP_DUE_STYLE}>{due}</span> : null}
                        </span>
                      );
                    })}

                    {optionalDatasets.length > 0 ? (
                      <span style={FACT_CHIP_STYLE}>
                        optional: <b>{optionalDatasets.map((id) => DATASET_NAMES[id as keyof typeof DATASET_NAMES] ?? id).join(", ")}</b>
                      </span>
                    ) : null}
                    {optionalCountries.length > 0 ? (
                      <span style={FACT_CHIP_STYLE}>
                        {optionalCountries.length} of {ZOHO_COUNTRIES.length} marketplaces optional
                      </span>
                    ) : null}

                    {current.startsFrom ? (
                      <span style={FACT_CHIP_STYLE}>
                        starts <b>{monthLabel(current.startsFrom)}</b>
                      </span>
                    ) : null}
                  </Space>

                  {orphaned.length > 0 ? (
                    <Alert
                      type="warning"
                      showIcon
                      message={`No ${orphaned.join(" or ")} periods are being opened`}
                      description={`This report is prepared per ${orphaned.join(" and ")}, but the schedule under Settings → Periods does not open ${orphaned.length === 1 ? "that period" : "those periods"}, so no card will ever appear for ${orphaned.length === 1 ? "it" : "them"}.`}
                    />
                  ) : null}

                  {everythingOptional ? (
                    <Alert
                      type="warning"
                      showIcon
                      message="Every channel is optional"
                      description="The report now builds from whatever happens to be uploaded. A month where a channel's file was simply forgotten will look complete and understate it. Meant for when a channel is genuinely retired."
                    />
                  ) : null}

                  <Collapse
                    ghost
                    size="small"
                    items={[
                      {
                        key: "configure",
                        label: <Typography.Text style={{ fontSize: 12.5 }}>Configure</Typography.Text>,
                        children: (
                          <Space direction="vertical" size={16} style={{ width: "100%" }}>
                            <div>
                              <Space size={6}>
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  Prepared per — and, for each, the day it falls due
                                </Typography.Text>
                                <Tooltip title="A monthly or quarterly report is due the given day of the month right after the period ends; a yearly report is due the given month and day, the year after. Editing a due date recalculates every period's deadline immediately — nothing is stored per period.">
                                  <InfoCircleOutlined style={{ color: "var(--ant-color-text-tertiary)", cursor: "help" }} />
                                </Tooltip>
                              </Space>
                              <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 8 }}>
                                <Space size={4} wrap>
                                  {GRANULARITIES.map((granularity) => {
                                    const supported = definition.granularity.includes(granularity);
                                    const on = supported && current.granularities[granularity] !== false;
                                    // The last one cannot be unticked: a report prepared for no
                                    // period at all is an off report said a confusing way.
                                    const last =
                                      on && definition.granularity.length - disabledGranularities.length === 1;

                                    return (
                                      <Tooltip
                                        key={granularity}
                                        title={
                                          supported
                                            ? last
                                              ? "The only period this report is prepared for. Turn the report off instead."
                                              : undefined
                                            : `${definition.label} is not built per ${granularity}.`
                                        }
                                      >
                                        <Tag.CheckableTag
                                          checked={on}
                                          style={{
                                            border: "1px solid var(--ant-color-border)",
                                            userSelect: "none",
                                            textTransform: "capitalize",
                                            ...(canEdit && !pending && supported && !last
                                              ? {}
                                              : { pointerEvents: "none", opacity: supported ? 0.6 : 0.35 }),
                                          }}
                                          onChange={(checked) => {
                                            const next = definition.granularity.filter((candidate) =>
                                              candidate === granularity
                                                ? !checked
                                                : current.granularities[candidate] === false,
                                            );

                                            save(definition.id, {
                                              enabled: true,
                                              optionalDatasets,
                                              optionalCountries,
                                              disabledGranularities: next,
                                            });
                                          }}
                                        >
                                          {granularity}
                                        </Tag.CheckableTag>
                                      </Tooltip>
                                    );
                                  })}
                                </Space>

                                {preparedGranularities.map((granularity) => {
                                  const rule = deadlines?.get(granularity);

                                  return (
                                    <Space key={granularity} size={8} wrap align="center">
                                      <Typography.Text style={{ fontSize: 12, minWidth: 60, textTransform: "capitalize" }}>
                                        {granularity} due
                                      </Typography.Text>
                                      {granularity === "year" ? (
                                        <Select
                                          size="small"
                                          disabled={!canEditDeadlines || pending || !rule}
                                          value={rule?.rule.month ?? 1}
                                          style={{ width: 120 }}
                                          options={MONTHS.map((month) => ({ value: month.number, label: month.fullName }))}
                                          onChange={(month) =>
                                            rule && saveDeadline(definition.id, granularity, rule.rule.day, month)
                                          }
                                        />
                                      ) : null}
                                      <DeadlineDayField
                                        key={rule?.rule.day ?? "unset"}
                                        day={rule?.rule.day}
                                        disabled={!canEditDeadlines || pending || !rule}
                                        onCommit={(day) =>
                                          rule && saveDeadline(definition.id, granularity, day, rule.rule.month)
                                        }
                                      />
                                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                        {granularity === "year" ? "day of that month, the year after" : "day of the month after"}
                                      </Typography.Text>
                                    </Space>
                                  );
                                })}
                              </Space>
                            </div>

                            <div>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                Starts from
                              </Typography.Text>
                              <div style={{ marginTop: 6 }}>
                                <Space size={8} wrap align="center">
                                  <Typography.Text>
                                    {current.startsFrom ? monthLabel(current.startsFrom) : "The beginning"}
                                  </Typography.Text>
                                  <Button
                                    size="small"
                                    disabled={!canEdit || pending}
                                    onClick={() => openStartDateModal(definition, current.startsFrom)}
                                  >
                                    Change…
                                  </Button>
                                </Space>
                              </div>
                            </div>

                            {definition.id === "off_amazon_sales" ? (
                              <div>
                                <Space size={6}>
                                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                    Required / optional per channel
                                  </Typography.Text>
                                  <Tooltip title="Required — the report will not build for a period until this channel's file is uploaded. Optional — included whenever its file is there, but never blocks the build.">
                                    <InfoCircleOutlined style={{ color: "var(--ant-color-text-tertiary)", cursor: "help" }} />
                                  </Tooltip>
                                </Space>
                                <Space direction="vertical" size="small" style={{ width: "100%", marginTop: 6 }}>
                                  {definition.datasets.map((dataset) => (
                                    <Space key={dataset} size={12} wrap>
                                      <Typography.Text style={{ minWidth: 90, display: "inline-block" }}>
                                        {DATASET_NAMES[dataset]}
                                      </Typography.Text>
                                      <Segmented
                                        size="small"
                                        disabled={!canEdit || pending}
                                        value={current.datasets[dataset] ?? "required"}
                                        options={[
                                          { label: "Required", value: "required" },
                                          { label: "Optional", value: "optional" },
                                        ]}
                                        onChange={(requirement) => {
                                          const next = definition.datasets.filter((candidate) =>
                                            candidate === dataset
                                              ? requirement === "optional"
                                              : (current.datasets[candidate] ?? "required") === "optional",
                                          );

                                          save(definition.id, {
                                            enabled: true,
                                            optionalDatasets: next,
                                            optionalCountries,
                                            disabledGranularities,
                                          });
                                        }}
                                      />
                                    </Space>
                                  ))}
                                </Space>
                              </div>
                            ) : definition.id === "amazon_zoho_invoice" ? (
                              <div>
                                <Space size={6}>
                                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                    Required / optional per marketplace
                                  </Typography.Text>
                                  <Tooltip title="A ticked marketplace is required; an unticked one is optional and still invoiced whenever its file is there. Untick one Amazon has been left, not one whose file is merely late.">
                                    <InfoCircleOutlined style={{ color: "var(--ant-color-text-tertiary)", cursor: "help" }} />
                                  </Tooltip>
                                </Space>
                                <Space size={4} wrap style={{ marginTop: 6 }}>
                                  {ZOHO_COUNTRIES.map((country) => {
                                    const required = (current.countries[country] ?? "required") === "required";

                                    return (
                                      <Tag.CheckableTag
                                        key={country}
                                        checked={required}
                                        style={{
                                          border: "1px solid var(--ant-color-border)",
                                          userSelect: "none",
                                          ...(canEdit && !pending ? {} : { pointerEvents: "none", opacity: 0.6 }),
                                        }}
                                        onChange={(checked) => {
                                          const next = ZOHO_COUNTRIES.filter((candidate) =>
                                            candidate === country
                                              ? !checked
                                              : (current.countries[candidate] ?? "required") === "optional",
                                          );

                                          save(definition.id, {
                                            enabled: true,
                                            optionalDatasets,
                                            optionalCountries: next,
                                            disabledGranularities,
                                          });
                                        }}
                                      >
                                        {country}
                                      </Tag.CheckableTag>
                                    );
                                  })}
                                </Space>
                              </div>
                            ) : definition.variants ? (
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                One switch for all custom reports at once. Which ones exist — and
                                what each counts — is edited on the Custom reports tab.
                              </Typography.Text>
                            ) : (
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                Reads the single Amazon VAT file, so there is nothing to require or
                                relax here.
                              </Typography.Text>
                            )}
                          </Space>
                        ),
                      },
                    ]}
                  />
                </Space>
              )}
            </Card>
          );
        })}
      </Space>

      <Modal
        title={startDateModal ? `${startDateModal.definition.label} — starts from` : ""}
        open={startDateModal !== null}
        onCancel={() => setStartDateModal(null)}
        footer={null}
        destroyOnClose
      >
        {startDateModal ? (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              type="warning"
              showIcon
              message="This changes what is offered right now"
              description="Periods before the chosen month disappear from Reports and from the dashboard for this report — as if it had never been enabled for them. Reports already built for those periods are not touched or deleted."
            />

            <Space size={8} wrap>
              <Select
                style={{ width: 150 }}
                value={startDateModal.month}
                options={MONTHS.map((month) => ({ value: month.number, label: month.fullName }))}
                onChange={(month) => setStartDateModal({ ...startDateModal, month })}
              />
              <Select
                style={{ width: 100 }}
                value={startDateModal.year}
                options={YEAR_OPTIONS.map((year) => ({ value: year, label: String(year) }))}
                onChange={(year) => setStartDateModal({ ...startDateModal, year })}
              />
            </Space>

            <Space style={{ width: "100%", justifyContent: "flex-end" }}>
              <Popconfirm
                title="Remove the start date?"
                description="Every period this report can build for is offered again."
                okText="Remove"
                cancelText="Cancel"
                onConfirm={() => saveStartDate(null)}
              >
                <Button danger>No start date</Button>
              </Popconfirm>
              <Popconfirm
                title="Change the start date?"
                description={`Periods before ${monthLabel(`${startDateModal.year}-${String(startDateModal.month).padStart(2, "0")}-01`)} will no longer offer this report.`}
                okText="Change"
                cancelText="Cancel"
                onConfirm={() =>
                  saveStartDate(`${startDateModal.year}-${String(startDateModal.month).padStart(2, "0")}-01`)
                }
              >
                <Button type="primary">Save</Button>
              </Popconfirm>
            </Space>
          </Space>
        ) : null}
      </Modal>
    </>
  );
}
