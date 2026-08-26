"use client";

import { InfoCircleOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  InputNumber,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useState, type ReactNode } from "react";

import type { PeriodGranularity } from "@/lib/db/schema";
import { defaultDeadlineRule } from "@/lib/reports/deadlines";
import type { DeadlineRuleRow } from "@/lib/reports/deadlines-queries";
import { saveDeadlineRule, type DeadlineActionResult } from "@/lib/reports/deadlines-actions";
import { MONTHS } from "@/lib/ingest/months";
import type { PeriodSchedule } from "@/lib/periods/schedule";
import { REPORT_DEFINITIONS, type ReportDefinition, type ReportTypeId } from "@/lib/reports/definitions";
import type { AllReportSettings } from "@/lib/reports/settings";
import { DATASET_NAMES } from "@/modules/channels/registry";
import {
  saveReportSettings,
  saveReportStartDate,
  type SettingsActionResult,
} from "@/lib/reports/settings-actions";
import { ZOHO_COUNTRIES } from "@/modules/reports/amazon-zoho-invoice";

type ActionResult = SettingsActionResult | DeadlineActionResult;
type Runner = (action: () => Promise<ActionResult>) => void;

const THIS_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 9 }, (_, index) => THIS_YEAR + 1 - index);
const GRANULARITIES: PeriodGranularity[] = ["month", "quarter", "year"];

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

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;

  const sorted = [...b].sort();

  return [...a].sort().every((value, index) => value === sorted[index]);
}

/**
 * What's being edited for one report, staged locally until Save. Nothing
 * here reaches the server on its own — the field that used to save on every
 * keystroke (and made an unrelated save elsewhere look like it had reset it)
 * is just local state now, like everything else in this form.
 */
type EditDraft = {
  disabledGranularities: string[];
  dueDay: Partial<Record<PeriodGranularity, number>>;
  dueMonth: Partial<Record<PeriodGranularity, number>>;
  startsFrom: string | null;
  optionalDatasets: string[];
  optionalCountries: string[];
};

function buildDraft(
  definition: ReportDefinition,
  current: AllReportSettings[ReportTypeId],
  deadlines: Map<PeriodGranularity, DeadlineRuleRow> | undefined,
): EditDraft {
  const dueDay: Partial<Record<PeriodGranularity, number>> = {};
  const dueMonth: Partial<Record<PeriodGranularity, number>> = {};

  for (const granularity of definition.granularity) {
    const rule = deadlines?.get(granularity)?.rule;

    if (rule) {
      dueDay[granularity] = rule.day;
      if (rule.month !== null) dueMonth[granularity] = rule.month;
    }
  }

  return {
    disabledGranularities: Object.entries(current.granularities)
      .filter(([, on]) => !on)
      .map(([key]) => key),
    dueDay,
    dueMonth,
    startsFrom: current.startsFrom,
    optionalDatasets: Object.entries(current.datasets)
      .filter(([, requirement]) => requirement === "optional")
      .map(([key]) => key),
    optionalCountries: Object.entries(current.countries)
      .filter(([, requirement]) => requirement === "optional")
      .map(([key]) => key),
  };
}

/**
 * The client's own description of how their reporting works: which reports
 * exist, what each one insists on before it will build, and when it falls
 * due. A viewer sees the same summary as everyone — plain text plus an (i)
 * on each row — with no way to open it. An owner or accountant gets a single
 * Edit button per card instead of a control on every row: it opens every
 * group at once, and nothing changes until Save.
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
  const { modal } = App.useApp();
  const canOpenEdit = canEdit || canEditDeadlines;

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

  const deadlinesByReport = new Map<string, Map<PeriodGranularity, DeadlineRuleRow>>();

  for (const rule of deadlineRules) {
    const byGranularity = deadlinesByReport.get(rule.reportType) ?? new Map();

    byGranularity.set(rule.granularity, rule);
    deadlinesByReport.set(rule.reportType, byGranularity);
  }

  const [editingId, setEditingId] = useState<ReportTypeId | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [original, setOriginal] = useState<EditDraft | null>(null);

  const openEdit = (
    definition: ReportDefinition,
    current: AllReportSettings[ReportTypeId],
    deadlines: Map<PeriodGranularity, DeadlineRuleRow> | undefined,
  ) => {
    const next = buildDraft(definition, current, deadlines);

    setEditingId(definition.id);
    setDraft(next);
    setOriginal(next);
  };

  const closeEdit = () => {
    setEditingId(null);
    setDraft(null);
    setOriginal(null);
  };

  const isDirty = draft !== null && original !== null && JSON.stringify(draft) !== JSON.stringify(original);

  const cancelEdit = () => {
    if (!isDirty) {
      closeEdit();
      return;
    }

    modal.confirm({
      title: "Discard changes?",
      content: "Closing now discards what you changed in this card.",
      okText: "Discard",
      okButtonProps: { danger: true },
      cancelText: "Keep editing",
      onOk: closeEdit,
    });
  };

  const saveEdit = (
    definition: ReportDefinition,
    current: AllReportSettings[ReportTypeId],
    deadlines: Map<PeriodGranularity, DeadlineRuleRow> | undefined,
  ) => {
    if (!draft || !original) return;

    const settingsChanged =
      canEdit &&
      (!sameSet(draft.disabledGranularities, original.disabledGranularities) ||
        !sameSet(draft.optionalDatasets, original.optionalDatasets) ||
        !sameSet(draft.optionalCountries, original.optionalCountries));

    const deadlineChanges = canEditDeadlines
      ? definition.granularity.filter((granularity) => {
          if (draft.disabledGranularities.includes(granularity)) return false;

          const fallback = defaultDeadlineRule(granularity);
          const day = draft.dueDay[granularity] ?? fallback.day;
          const month = granularity === "year" ? draft.dueMonth[granularity] ?? fallback.month : null;
          const existing = deadlines?.get(granularity)?.rule;

          if (!existing) return true;

          return existing.day !== day || (granularity === "year" && existing.month !== month);
        })
      : [];

    const startsFromChanged = canEdit && draft.startsFrom !== original.startsFrom;

    if (!settingsChanged && deadlineChanges.length === 0 && !startsFromChanged) {
      closeEdit();
      return;
    }

    const commit = () => {
      run(async () => {
        if (settingsChanged) {
          const result = await saveReportSettings({
            reportType: definition.id,
            enabled: current.enabled,
            optionalDatasets: draft.optionalDatasets,
            optionalCountries: draft.optionalCountries,
            disabledGranularities: draft.disabledGranularities,
          });

          if (!result.ok) return result;
        }

        for (const granularity of deadlineChanges) {
          const fallback = defaultDeadlineRule(granularity);
          const day = draft.dueDay[granularity] ?? fallback.day;
          const month = granularity === "year" ? (draft.dueMonth[granularity] ?? fallback.month ?? 1) : null;

          const result = await saveDeadlineRule({ reportType: definition.id, granularity, day, month });

          if (!result.ok) return result;
        }

        if (startsFromChanged) {
          const result = await saveReportStartDate({ reportType: definition.id, startsFrom: draft.startsFrom });

          if (!result.ok) return result;
        }

        return { ok: true, message: `${definition.label} updated.` };
      });

      closeEdit();
    };

    if (startsFromChanged) {
      modal.confirm({
        title: draft.startsFrom
          ? `Move the start date to ${monthLabel(draft.startsFrom)}?`
          : "Remove the start date?",
        content: draft.startsFrom
          ? `Periods before ${monthLabel(draft.startsFrom)} will no longer offer this report — not on Reports, not on the dashboard. Reports already built for them are not touched or deleted.`
          : "Every period this report can build for is offered again.",
        okText: draft.startsFrom ? "Move start date" : "Remove",
        cancelText: "Cancel",
        onOk: commit,
      });
    } else {
      commit();
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {REPORT_DEFINITIONS.map((definition) => {
        const current = settings[definition.id];
        const optionalDatasets = Object.entries(current.datasets)
          .filter(([, requirement]) => requirement === "optional")
          .map(([key]) => key);
        const optionalCountries = Object.entries(current.countries)
          .filter(([, requirement]) => requirement === "optional")
          .map(([key]) => key);
        const disabledGranularities = Object.entries(current.granularities)
          .filter(([, on]) => !on)
          .map(([key]) => key);
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

        const editing = editingId === definition.id && draft !== null;

        const periodsSummary = preparedGranularities
          .map((granularity) => {
            const due = dueLabel(granularity, deadlines?.get(granularity)?.rule);
            const name = granularity[0].toUpperCase() + granularity.slice(1);

            return due ? `${name} (${due})` : name;
          })
          .join(" · ");

        const availabilitySummary = current.startsFrom
          ? `offered from ${monthLabel(current.startsFrom)} onward`
          : "no start date — every period is offered";

        const hasFileRequirements = definition.id === "off_amazon_sales" || definition.id === "amazon_zoho_invoice";

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
                {canEdit ? (
                  current.enabled ? (
                    <Popconfirm
                      title="Turn off this report?"
                      description="Reports already built stay exactly where they are. No new periods will build until you turn it back on."
                      okText="Turn off"
                      okButtonProps={{ danger: true }}
                      cancelText="Cancel"
                      onConfirm={() =>
                        save(definition.id, { enabled: false, optionalDatasets, optionalCountries, disabledGranularities })
                      }
                    >
                      <Switch checked disabled={pending} aria-label={`${definition.label} on or off`} />
                    </Popconfirm>
                  ) : (
                    <Switch
                      checked={false}
                      disabled={pending}
                      aria-label={`${definition.label} on or off`}
                      onChange={(enabled) =>
                        save(definition.id, { enabled, optionalDatasets, optionalCountries, disabledGranularities })
                      }
                    />
                  )
                ) : (
                  <Tag color={current.enabled ? "success" : "default"}>{current.enabled ? "On" : "Off"}</Tag>
                )}

                {current.enabled && canOpenEdit && !editing ? (
                  <Button size="small" onClick={() => openEdit(definition, current, deadlines)}>
                    Edit
                  </Button>
                ) : null}
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

                {!editing ? (
                  <SettingsSummary
                    periodsSummary={periodsSummary}
                    availabilitySummary={availabilitySummary}
                    hasFileRequirements={hasFileRequirements}
                    definition={definition}
                    current={current}
                  />
                ) : (
                  <EditForm
                    definition={definition}
                    draft={draft}
                    setDraft={(updater) => setDraft((d) => (d ? updater(d) : d))}
                    canEdit={canEdit}
                    canEditDeadlines={canEditDeadlines}
                    pending={pending}
                    onSave={() => saveEdit(definition, current, deadlines)}
                    onCancel={cancelEdit}
                  />
                )}
              </Space>
            )}
          </Card>
        );
      })}
    </Space>
  );
}

function SettingsSummary({
  periodsSummary,
  availabilitySummary,
  hasFileRequirements,
  definition,
  current,
}: {
  periodsSummary: string;
  availabilitySummary: string;
  hasFileRequirements: boolean;
  definition: ReportDefinition;
  current: AllReportSettings[ReportTypeId];
}) {
  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      <SummaryRow
        label="Periods & deadlines"
        tip="A monthly or quarterly report is due the given day of the month right after the period ends; a yearly report is due the given month and day, the year after."
      >
        {periodsSummary || "not prepared for any period"}
      </SummaryRow>

      <SummaryRow
        label="Availability"
        tip="Periods before the start date don't offer the report at all — not on Reports, not on the dashboard."
      >
        {availabilitySummary}
      </SummaryRow>

      {hasFileRequirements ? (
        <SummaryRow
          label="File requirements"
          tip="Required — the report won't build for a period until this file is uploaded. Optional — included whenever its file is there, but never blocks the build."
        >
          <Space size={4} wrap>
            {definition.id === "off_amazon_sales"
              ? definition.datasets.map((dataset) => {
                  const required = (current.datasets[dataset] ?? "required") === "required";

                  return (
                    <Tag key={dataset} color={required ? "processing" : "default"}>
                      {DATASET_NAMES[dataset]} — {required ? "required" : "optional"}
                    </Tag>
                  );
                })
              : ZOHO_COUNTRIES.map((country) => {
                  const required = (current.countries[country] ?? "required") === "required";

                  return (
                    <Tag key={country} color={required ? "processing" : "default"}>
                      {country} — {required ? "required" : "optional"}
                    </Tag>
                  );
                })}
          </Space>
        </SummaryRow>
      ) : null}
    </Space>
  );
}

function SummaryRow({ label, tip, children }: { label: string; tip: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <Space size={5} style={{ flex: "0 0 190px" }}>
        <Typography.Text
          type="secondary"
          style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase" }}
        >
          {label}
        </Typography.Text>
        <Tooltip title={tip}>
          <InfoCircleOutlined style={{ color: "var(--ant-color-text-tertiary)", cursor: "help", fontSize: 12 }} />
        </Tooltip>
      </Space>
      <div style={{ flex: 1, fontSize: 13, minWidth: 200 }}>{children}</div>
    </div>
  );
}

function EditForm({
  definition,
  draft,
  setDraft,
  canEdit,
  canEditDeadlines,
  pending,
  onSave,
  onCancel,
}: {
  definition: ReportDefinition;
  draft: EditDraft;
  setDraft: (updater: (draft: EditDraft) => EditDraft) => void;
  canEdit: boolean;
  canEditDeadlines: boolean;
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const restrictAvailability = draft.startsFrom !== null;
  const [year, month] = draft.startsFrom
    ? draft.startsFrom.split("-").map(Number)
    : [THIS_YEAR, new Date().getMonth() + 1];

  return (
    <Space direction="vertical" size={18} style={{ width: "100%" }}>
      <div>
        <FieldLabel tip="Turn a period on to build it, and set the day after the period ends that it falls due.">
          Periods &amp; deadlines
        </FieldLabel>
        <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 6 }}>
          {GRANULARITIES.map((granularity) => {
            const supported = definition.granularity.includes(granularity);

            if (!supported) return null;

            const on = !draft.disabledGranularities.includes(granularity);
            const last = on && definition.granularity.length - draft.disabledGranularities.length === 1;
            const fallback = defaultDeadlineRule(granularity);
            const day = draft.dueDay[granularity] ?? fallback.day;
            const monthValue = draft.dueMonth[granularity] ?? fallback.month ?? 1;

            return (
              <Space key={granularity} size={10} wrap align="center">
                <Tooltip title={last ? "The only period this report is prepared for. Turn the report off instead." : undefined}>
                  <Switch
                    size="small"
                    checked={on}
                    disabled={!canEdit || pending || last}
                    onChange={(checked) =>
                      setDraft((d) => ({
                        ...d,
                        disabledGranularities: checked
                          ? d.disabledGranularities.filter((g) => g !== granularity)
                          : [...d.disabledGranularities, granularity],
                      }))
                    }
                  />
                </Tooltip>
                <Typography.Text style={{ textTransform: "capitalize", width: 64 }}>{granularity}</Typography.Text>

                {on ? (
                  <Space size={6} wrap align="center">
                    {granularity === "year" ? (
                      <Select
                        size="small"
                        disabled={!canEditDeadlines || pending}
                        value={monthValue}
                        style={{ width: 120 }}
                        options={MONTHS.map((m) => ({ value: m.number, label: m.fullName }))}
                        onChange={(value) =>
                          setDraft((d) => ({ ...d, dueMonth: { ...d.dueMonth, [granularity]: value } }))
                        }
                      />
                    ) : null}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      due
                    </Typography.Text>
                    <InputNumber
                      size="small"
                      min={1}
                      max={31}
                      style={{ width: 64 }}
                      disabled={!canEditDeadlines || pending}
                      value={day}
                      onChange={(value) =>
                        typeof value === "number" &&
                        setDraft((d) => ({ ...d, dueDay: { ...d.dueDay, [granularity]: value } }))
                      }
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {granularity === "year" ? "of that month, the year after" : "of the month after"}
                    </Typography.Text>
                  </Space>
                ) : (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    off
                  </Typography.Text>
                )}
              </Space>
            );
          })}
        </Space>
      </div>

      <div>
        <FieldLabel tip="The first period this report is offered for. Periods before it never appear, on Reports or the dashboard.">
          Availability
        </FieldLabel>
        <Space size={10} wrap align="center" style={{ marginTop: 6 }}>
          <Segmented
            size="small"
            disabled={!canEdit || pending}
            value={restrictAvailability ? "from" : "no-limit"}
            options={[
              { label: "No limit", value: "no-limit" },
              { label: "From a date", value: "from" },
            ]}
            onChange={(value) =>
              setDraft((d) => ({
                ...d,
                startsFrom:
                  value === "from"
                    ? `${THIS_YEAR}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`
                    : null,
              }))
            }
          />

          {restrictAvailability ? (
            <Space size={8}>
              <Select
                size="small"
                style={{ width: 130 }}
                disabled={!canEdit || pending}
                value={month}
                options={MONTHS.map((m) => ({ value: m.number, label: m.fullName }))}
                onChange={(value) =>
                  setDraft((d) => ({ ...d, startsFrom: `${year}-${String(value).padStart(2, "0")}-01` }))
                }
              />
              <Select
                size="small"
                style={{ width: 90 }}
                disabled={!canEdit || pending}
                value={year}
                options={YEAR_OPTIONS.map((y) => ({ value: y, label: String(y) }))}
                onChange={(value) =>
                  setDraft((d) => ({ ...d, startsFrom: `${value}-${String(month).padStart(2, "0")}-01` }))
                }
              />
            </Space>
          ) : null}
        </Space>
      </div>

      {definition.id === "off_amazon_sales" ? (
        <div>
          <FieldLabel tip="Required — the report won't build for a period until this channel's file is uploaded. Optional — included whenever its file is there, but never blocks the build.">
            File requirements
          </FieldLabel>
          <Space direction="vertical" size={6} style={{ width: "100%", marginTop: 6 }}>
            {definition.datasets.map((dataset) => {
              const required = !draft.optionalDatasets.includes(dataset);

              return (
                <Space key={dataset} size={10}>
                  <Switch
                    size="small"
                    checked={required}
                    disabled={!canEdit || pending}
                    onChange={(checked) =>
                      setDraft((d) => ({
                        ...d,
                        optionalDatasets: checked
                          ? d.optionalDatasets.filter((x) => x !== dataset)
                          : [...d.optionalDatasets, dataset],
                      }))
                    }
                  />
                  <Typography.Text style={{ minWidth: 90, display: "inline-block" }}>
                    {DATASET_NAMES[dataset]}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {required ? "Required" : "Optional"}
                  </Typography.Text>
                </Space>
              );
            })}
          </Space>
        </div>
      ) : definition.id === "amazon_zoho_invoice" ? (
        <div>
          <FieldLabel tip="Required — invoiced only when present, and blocks the build until it is. Optional — invoiced whenever its file is there, but never blocks the build.">
            File requirements
          </FieldLabel>
          <Space direction="vertical" size={6} style={{ width: "100%", marginTop: 6 }}>
            {ZOHO_COUNTRIES.map((country) => {
              const required = !draft.optionalCountries.includes(country);

              return (
                <Space key={country} size={10}>
                  <Switch
                    size="small"
                    checked={required}
                    disabled={!canEdit || pending}
                    onChange={(checked) =>
                      setDraft((d) => ({
                        ...d,
                        optionalCountries: checked
                          ? d.optionalCountries.filter((x) => x !== country)
                          : [...d.optionalCountries, country],
                      }))
                    }
                  />
                  <Typography.Text style={{ minWidth: 40, display: "inline-block" }}>{country}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {required ? "Required" : "Optional"}
                  </Typography.Text>
                </Space>
              );
            })}
          </Space>
        </div>
      ) : definition.variants ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          One switch for all custom reports at once. Which ones exist — and what each counts — is
          edited on the Custom reports tab.
        </Typography.Text>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Reads the single Amazon VAT file, so there is nothing to require or relax here.
        </Typography.Text>
      )}

      <Space style={{ width: "100%", justifyContent: "flex-end", borderTop: "1px solid var(--ant-color-split)", paddingTop: 12 }}>
        <Button onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="primary" onClick={onSave} loading={pending}>
          Save
        </Button>
      </Space>
    </Space>
  );
}

function FieldLabel({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <Space size={5}>
      <Typography.Text
        type="secondary"
        style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase" }}
      >
        {children}
      </Typography.Text>
      <Tooltip title={tip}>
        <InfoCircleOutlined style={{ color: "var(--ant-color-text-tertiary)", cursor: "help", fontSize: 12 }} />
      </Tooltip>
    </Space>
  );
}
