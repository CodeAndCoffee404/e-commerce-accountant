"use client";

import {
  Alert,
  Button,
  Card,
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
import { useState } from "react";

import type { PeriodGranularity } from "@/lib/db/schema";
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

type Runner = (action: () => Promise<SettingsActionResult>) => void;

const THIS_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 9 }, (_, index) => THIS_YEAR + 1 - index);

function monthLabel(startsFrom: string): string {
  const [year, month] = startsFrom.split("-");

  return `${MONTHS[Number(month) - 1]?.fullName ?? month} ${year}`;
}

/**
 * The client's own description of how their reporting works: which reports
 * exist, and what each one insists on before it will build.
 *
 * The vocabulary is required/optional rather than add/remove. A retired
 * channel should stop blocking builds, but if its file does arrive, the rows
 * must still be counted — removing the channel outright would silently drop
 * data that exists.
 */
export function ReportSettingsTab({
  settings,
  schedule,
  canEdit,
  run,
  pending,
}: {
  settings: AllReportSettings;
  /** Only to warn when a report is prepared for a period nobody opens. */
  schedule: PeriodSchedule;
  canEdit: boolean;
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

  const optionalOf = (record: Record<string, Requirement>) =>
    Object.entries(record)
      .filter(([, requirement]) => requirement === "optional")
      .map(([key]) => key);

  const disabledOf = (record: Record<string, boolean>) =>
    Object.entries(record)
      .filter(([, on]) => !on)
      .map(([key]) => key);

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
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        <Typography.Text strong>Required</Typography.Text> — the report will not build for a
        period until this piece is uploaded. <Typography.Text strong>Optional</Typography.Text> —
        included whenever its file is there, but never blocks the build. Every change is recorded
        under Activity, and each report run keeps the configuration it was built with.
      </Typography.Paragraph>

      {REPORT_DEFINITIONS.map((definition) => {
        const current = settings[definition.id];
        const optionalDatasets = optionalOf(current.datasets);
        const optionalCountries = optionalOf(current.countries);
        const disabledGranularities = disabledOf(current.granularities);
        // A report prepared for a period the tenant never opens is a card that
        // will never appear, with nothing on this page to explain why.
        const orphaned = definition.granularity.filter(
          (granularity) =>
            current.granularities[granularity] !== false && !schedule[granularity],
        );
        const everythingOptional =
          definition.id === "off_amazon_sales" &&
          optionalDatasets.length === definition.datasets.length;

        return (
          <Card
            key={definition.id}
            size="small"
            title={definition.label}
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
                    save(definition.id, {
                      enabled,
                      optionalDatasets,
                      optionalCountries,
                      disabledGranularities,
                    })
                  }
                />
              </Space>
            }
          >
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              {definition.description}
            </Typography.Paragraph>

            {!current.enabled ? (
              <Typography.Text type="secondary">
                Hidden from Reports and refuses to build. Nothing else changes — uploads for its
                channels are still accepted and kept.
              </Typography.Text>
            ) : null}

            {current.enabled ? (
              <Space direction="vertical" size={4} style={{ width: "100%", marginBottom: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Prepared per:
                </Typography.Text>
                <Space size={4} wrap>
                  {(["month", "quarter", "year"] as PeriodGranularity[]).map((granularity) => {
                    const supported = definition.granularity.includes(granularity);
                    const on = supported && current.granularities[granularity] !== false;
                    // The last one cannot be unticked: a report prepared for no
                    // period at all is an off report said a confusing way.
                    const last = on && definition.granularity.length - disabledGranularities.length === 1;

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

                {orphaned.length > 0 ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 4 }}
                    message={`No ${orphaned.join(" or ")} periods are being opened`}
                    description={`This report is prepared per ${orphaned.join(" and ")}, but the schedule under Settings → Periods does not open ${orphaned.length === 1 ? "that period" : "those periods"}, so no card will ever appear for ${orphaned.length === 1 ? "it" : "them"}.`}
                  />
                ) : null}

                <Space
                  size={8}
                  wrap
                  align="center"
                  style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--ant-color-split)" }}
                >
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Starts from:
                  </Typography.Text>
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
              </Space>
            ) : null}

            {!current.enabled ? null : definition.id === "off_amazon_sales" ? (
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
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

                {everythingOptional ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="Every channel is optional"
                    description="The report now builds from whatever happens to be uploaded. A month where a channel's file was simply forgotten will look complete and understate it. Meant for when a channel is genuinely retired."
                  />
                ) : null}
              </Space>
            ) : definition.id === "amazon_zoho_invoice" ? (
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  A ticked marketplace is required; an unticked one is optional and still invoiced
                  whenever its file is there. Untick one Amazon has been left, not one whose file
                  is merely late.
                </Typography.Text>
                <Space size={4} wrap>
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
              </Space>
            ) : definition.variants ? (
              <Typography.Text type="secondary">
                One switch for all custom reports at once. Which ones exist — and what each
                counts — is edited on the Custom reports tab.
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary">
                Reads the single Amazon VAT file, so there is nothing to require or relax here.
              </Typography.Text>
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
