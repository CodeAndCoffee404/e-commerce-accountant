"use client";

import { Alert, Card, Segmented, Space, Switch, Tag, Typography } from "antd";

import { REPORT_DEFINITIONS, type ReportTypeId } from "@/lib/reports/definitions";
import type { AllReportSettings, Requirement } from "@/lib/reports/settings";
import { DATASET_NAMES } from "@/modules/channels/registry";
import {
  saveReportSettings,
  type SettingsActionResult,
} from "@/lib/reports/settings-actions";
import { ZOHO_COUNTRIES } from "@/modules/reports/amazon-zoho-invoice";

type Runner = (action: () => Promise<SettingsActionResult>) => void;

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
  canEdit,
  run,
  pending,
}: {
  settings: AllReportSettings;
  canEdit: boolean;
  run: Runner;
  pending: boolean;
}) {
  const save = (
    reportType: ReportTypeId,
    next: { enabled: boolean; optionalDatasets: string[]; optionalCountries: string[] },
  ) => {
    run(() => saveReportSettings({ reportType, ...next }));
  };

  const optionalOf = (record: Record<string, Requirement>) =>
    Object.entries(record)
      .filter(([, requirement]) => requirement === "optional")
      .map(([key]) => key);

  return (
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
                    save(definition.id, { enabled, optionalDatasets, optionalCountries })
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
            ) : definition.id === "off_amazon_sales" ? (
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
                          });
                        }}
                      >
                        {country}
                      </Tag.CheckableTag>
                    );
                  })}
                </Space>
              </Space>
            ) : (
              <Typography.Text type="secondary">
                Reads the single Amazon VAT file, so there is nothing to require or relax here.
              </Typography.Text>
            )}
          </Card>
        );
      })}
    </Space>
  );
}
