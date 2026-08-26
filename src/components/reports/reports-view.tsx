"use client";

import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  theme,
  Tooltip,
  Typography,
} from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { restoreDefaults, saveAllegroCurrency, saveSkuMapping } from "@/lib/reference/actions";
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

/**
 * Display labels only — the stored status (`queued`, `running`, …) never
 * changes, so nothing about the build pipeline or the database moves.
 */
const STATUS_LABELS: Record<string, string> = {
  queued: "Pending",
  running: "Building",
  succeeded: "Ready",
  failed: "Failed",
};

/** One buildable card: a report, or one tenant-defined variant of one. */
type BuildCard = {
  key: string;
  reportType: ReportTypeId;
  /** Set on variant cards; goes with the build so the run names its definition. */
  variant?: string;
  title: string;
  description: string;
  why: string;
  informational: boolean;
  availability: ReportAvailability;
  /** True for the hint card shown while a variants report has no definitions. */
  placeholder?: boolean;
};

export function ReportsView({
  runs,
  periods,
  missingRules,
  canBuild,
  canRestore,
  canEditSkuMappings,
  canEditCurrencyMappings,
}: {
  runs: ReportRunCard[];
  periods: Record<ReportTypeId, ReportAvailability>;
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
  const [choice, setChoice] = useState<Record<string, string | undefined>>({});
  // Which card is being built, so the other cards stay still.
  const [building, setBuilding] = useState<string | null>(null);
  // Set when a build refuses on unmapped SKUs — carries what's needed to
  // save the mapping and retry the same build, without asking the card for
  // its period again.
  const [skuGate, setSkuGate] = useState<{ card: BuildCard; periodLabel: string; skus: string[] } | null>(
    null,
  );
  const [skuDrafts, setSkuDrafts] = useState<
    Record<string, { targetSku: string; itemName: string; ignored: boolean }>
  >({});
  const [savingSkus, setSavingSkus] = useState(false);

  // Same idea as skuGate, for a build refused on an Allegro currency that
  // isn't in currency_map yet.
  const [currencyGate, setCurrencyGate] = useState<{
    card: BuildCard;
    periodLabel: string;
    currencies: string[];
  } | null>(null);
  const [currencyDrafts, setCurrencyDrafts] = useState<
    Record<string, { country: string; scheme: string; sellerVat: string }>
  >({});
  const [savingCurrencies, setSavingCurrencies] = useState(false);

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
  const runPeriodOptions = useMemo(
    () => [...new Set(runs.map((run) => run.periodLabel))].sort().reverse(),
    [runs],
  );
  const runStatusOptions = useMemo(
    () => [...new Set(runs.map((run) => run.status))],
    [runs],
  );

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

  const build = (card: BuildCard) => {
    const periodLabel = choice[card.key];

    if (!periodLabel) {
      message.warning("Choose a period.");
      return;
    }

    setBuilding(card.key);

    startTransition(async () => {
      try {
        const result = await buildReport({
          reportType: card.reportType,
          periodLabel,
          ...(card.variant ? { variant: card.variant } : {}),
        });

        if (result.ok) {
          message.success(result.message, 6);
        } else if (result.needsSkuMapping && result.needsSkuMapping.length > 0) {
          // A form to fill in, not an error to read — the toast would just
          // repeat what the modal is about to say in more detail.
          setSkuGate({ card, periodLabel, skus: result.needsSkuMapping });
          setSkuDrafts({});
        } else if (result.needsCurrencyMapping && result.needsCurrencyMapping.length > 0) {
          setCurrencyGate({ card, periodLabel, currencies: result.needsCurrencyMapping });
          setCurrencyDrafts({});
        } else {
          // Ten seconds: it names the rule or the upload that is missing,
          // which is not readable in three.
          message.error(result.message, 10);
        }

        router.refresh();
      } catch {
        message.error("The server could not be reached — nothing was changed. Check the connection and try again.", 8);
      } finally {
        setBuilding(null);
      }
    });
  };

  const saveCurrenciesAndBuild = () => {
    if (!currencyGate) return;

    setSavingCurrencies(true);

    startTransition(async () => {
      try {
        for (const currency of currencyGate.currencies) {
          const draft = currencyDrafts[currency];

          const result = await saveAllegroCurrency({
            currency,
            country: draft?.country.trim() ?? "",
            scheme: draft?.scheme ?? "UNION-OSS",
            sellerVat: draft?.sellerVat.trim() ?? "",
          });

          if (!result.ok) {
            message.error(result.message, 8);
            setSavingCurrencies(false);
            return;
          }
        }

        const gate = currencyGate;
        const result = await buildReport({
          reportType: gate.card.reportType,
          periodLabel: gate.periodLabel,
          ...(gate.card.variant ? { variant: gate.card.variant } : {}),
        });

        if (result.ok) message.success(result.message, 6);
        else message.error(result.message, 10);

        setCurrencyGate(null);
        router.refresh();
      } catch {
        message.error("The server could not be reached — nothing was changed. Check the connection and try again.", 8);
      } finally {
        setSavingCurrencies(false);
      }
    });
  };

  const saveSkusAndBuild = () => {
    if (!skuGate) return;

    setSavingSkus(true);

    startTransition(async () => {
      try {
        for (const sku of skuGate.skus) {
          const draft = skuDrafts[sku];
          const ignored = draft?.ignored ?? false;

          const result = await saveSkuMapping({
            channel: "amazon",
            sourceSku: sku,
            targetSku: ignored ? null : (draft?.targetSku.trim() ?? null),
            itemName: ignored ? null : (draft?.itemName.trim() ?? null),
            isIgnored: ignored,
          });

          if (!result.ok) {
            message.error(result.message, 8);
            setSavingSkus(false);
            return;
          }
        }

        const gate = skuGate;
        const result = await buildReport({
          reportType: gate.card.reportType,
          periodLabel: gate.periodLabel,
          ...(gate.card.variant ? { variant: gate.card.variant } : {}),
        });

        if (result.ok) message.success(result.message, 6);
        // Every SKU above just got a decision, so this would only fire if
        // the period's rows changed underneath the save — worth surfacing
        // rather than assuming it can't happen.
        else message.error(result.message, 10);

        setSkuGate(null);
        router.refresh();
      } catch {
        message.error("The server could not be reached — nothing was changed. Check the connection and try again.", 8);
      } finally {
        setSavingSkus(false);
      }
    });
  };

  // One card per report — and per stored definition where a report comes in
  // tenant-defined variants, each building separately under its own name.
  const cards: BuildCard[] = REPORT_DEFINITIONS.flatMap((definition): BuildCard[] => {
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

    // No definitions yet: one quiet card saying where they are made, because a
    // feature nobody can find might as well not exist.
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
  });

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
        {cards.map((card) => {
          const ready = card.availability.ready;
          const waiting = card.availability.blocked;

          if (card.placeholder) {
            return (
              <Card
                key={card.key}
                size="small"
                title={card.title}
                extra={<Tag>informational</Tag>}
              >
                <Typography.Paragraph type="secondary" style={{ minHeight: 44 }}>
                  {card.description}
                </Typography.Paragraph>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  No definitions yet. Make one under{" "}
                  <Link href="/settings?tab=custom">Settings &rarr; Custom reports</Link> — it
                  gets its own card here and builds like any other report.
                </Typography.Text>
              </Card>
            );
          }

          return (
            <Card
              key={card.key}
              size="small"
              title={card.title}
              extra={card.informational ? <Tag>informational</Tag> : undefined}
            >
              <Typography.Paragraph type="secondary" style={{ minHeight: 44 }}>
                {card.description}
              </Typography.Paragraph>

              {/* Said before anything is uploaded, not discovered afterwards by
                  watching a button stay grey. */}
              <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                <Typography.Text strong style={{ fontSize: 12 }}>
                  Needs:
                </Typography.Text>{" "}
                {card.availability.needs}
              </Typography.Paragraph>

              <Space.Compact style={{ width: "100%" }}>
                <Select
                  style={{ width: "100%" }}
                  placeholder={ready.length === 0 ? "Nothing ready" : "Period"}
                  disabled={ready.length === 0}
                  value={choice[card.key]}
                  onChange={(value) => setChoice((current) => ({ ...current, [card.key]: value }))}
                  options={ready.map((period) => ({ value: period, label: period }))}
                />
                <Tooltip title="Building again is safe — each run is recorded separately with the rules and rates it used.">
                  <Button
                    type="primary"
                    loading={building === card.key}
                    disabled={building !== null || !canBuild || ready.length === 0}
                    onClick={() => build(card)}
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
                          <b>{entry.period}</b>
                          {/*
                            A period with nothing missing is waiting on the
                            calendar, not on anybody. Saying "still missing"
                            here would send someone looking for exports that
                            cannot exist yet.
                          */}
                          {entry.endsOn ? (
                            <> — everything is in; the period ends on {entry.endsOn}</>
                          ) : (
                            <>
                              {" "}
                              — still missing: {entry.missing.slice(0, 6).join(", ")}
                              {entry.missing.length > 6
                                ? ` and ${entry.missing.length - 6} more`
                                : ""}
                            </>
                          )}
                        </Typography.Text>
                      ))}
                      {waiting.length > 3 ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          and {waiting.length - 3} older period
                          {waiting.length - 3 === 1 ? "" : "s"}
                        </Typography.Text>
                      ) : null}
                      {card.why ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {card.why}
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

      {runs.length > 0 ? (
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
            style={{ minWidth: 180 }}
            placeholder="Type"
            value={runType}
            onChange={(value) => setRunType(value ?? undefined)}
            options={runTypeOptions}
          />
          <Select
            allowClear
            showSearch
            style={{ minWidth: 160 }}
            placeholder="Period"
            value={runPeriod}
            onChange={(value) => setRunPeriod(value ?? undefined)}
            options={runPeriodOptions.map((value) => ({ value, label: value }))}
          />
          <Select
            allowClear
            style={{ minWidth: 140 }}
            placeholder="Status"
            value={runStatus}
            onChange={(value) => setRunStatus(value ?? undefined)}
            options={runStatusOptions.map((value) => ({
              value,
              label: STATUS_LABELS[value] ?? value,
            }))}
          />
        </Space>
      ) : null}

      <Table<ReportRunCard>
        dataSource={filteredRuns}
        rowKey="id"
        size="small"
        loading={pending}
        scroll={{ x: 1100 }}
        pagination={filteredRuns.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
        locale={{
          emptyText: (
            <Empty
              description={
                runs.length === 0 ? (
                  <span>
                    No reports yet.
                    <br />
                    Pick a period above and build one.
                  </span>
                ) : (
                  "No reports match these filters."
                )
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
                <Tag color={STATUS_COLOURS[status] ?? "default"}>
                  {STATUS_LABELS[status] ?? status}
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
                      message.error("The server could not be reached — nothing was changed. Check the connection and try again.", 8);
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

      <SkuGateModal
        gate={skuGate}
        drafts={skuDrafts}
        setDrafts={setSkuDrafts}
        canEdit={canEditSkuMappings}
        saving={savingSkus}
        onCancel={() => setSkuGate(null)}
        onSave={saveSkusAndBuild}
      />

      <CurrencyGateModal
        gate={currencyGate}
        drafts={currencyDrafts}
        setDrafts={setCurrencyDrafts}
        canEdit={canEditCurrencyMappings}
        saving={savingCurrencies}
        onCancel={() => setCurrencyGate(null)}
        onSave={saveCurrenciesAndBuild}
      />
    </>
  );
}

/**
 * Stops a build that found SKUs with no row in SKU mapping yet, and asks for
 * each one before trying again — an unmapped SKU otherwise still reaches the
 * invoice under its own raw code, silently. Only the owner can save a
 * mapping (SKU mapping is company settings, same rule as everywhere else in
 * Settings), so an accountant sees the list without the form.
 */
function SkuGateModal({
  gate,
  drafts,
  setDrafts,
  canEdit,
  saving,
  onCancel,
  onSave,
}: {
  gate: { card: BuildCard; periodLabel: string; skus: string[] } | null;
  drafts: Record<string, { targetSku: string; itemName: string; ignored: boolean }>;
  setDrafts: (
    updater: (
      drafts: Record<string, { targetSku: string; itemName: string; ignored: boolean }>,
    ) => Record<string, { targetSku: string; itemName: string; ignored: boolean }>,
  ) => void;
  canEdit: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const skus = gate?.skus ?? [];

  const draftOf = (sku: string) => drafts[sku] ?? { targetSku: "", itemName: "", ignored: false };

  const decided = skus.filter((sku) => {
    const draft = draftOf(sku);

    return draft.ignored || (draft.targetSku.trim() !== "" && draft.itemName.trim() !== "");
  }).length;

  const setField = (sku: string, field: "targetSku" | "itemName", value: string) =>
    setDrafts((current) => ({ ...current, [sku]: { ...draftOf(sku), [field]: value } }));

  const setIgnored = (sku: string, ignored: boolean) =>
    setDrafts((current) => ({ ...current, [sku]: { ...draftOf(sku), ignored } }));

  return (
    <Modal
      title={
        skus.length === 1
          ? "Map this SKU before the invoice builds"
          : `Map ${skus.length} SKUs before the invoice builds`
      }
      open={gate !== null}
      onCancel={onCancel}
      footer={null}
      destroyOnHidden
      width={640}
    >
      {gate ? (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            {skus.length === 1 ? "This SKU appears" : "These SKUs appear"} in {gate.periodLabel}
            &rsquo;s Amazon rows and{" "}
            {skus.length === 1 ? "isn&rsquo;t" : "aren&rsquo;t"} in SKU mapping yet. Give{" "}
            {skus.length === 1 ? "it" : "each one"} an invoice code and item name, or mark it
            ignored — an ignored SKU is dropped from the invoice entirely.
          </Typography.Text>

          {canEdit ? (
            <>
              <Table
                dataSource={skus.map((sku) => ({ sku }))}
                rowKey="sku"
                size="small"
                pagination={false}
                columns={[
                  {
                    title: "Source SKU",
                    dataIndex: "sku",
                    width: 160,
                    render: (sku: string) => (
                      <Typography.Text code style={{ opacity: draftOf(sku).ignored ? 0.5 : 1 }}>
                        {sku}
                      </Typography.Text>
                    ),
                  },
                  {
                    title: "Invoice SKU",
                    key: "targetSku",
                    render: (_, { sku }: { sku: string }) => (
                      <Input
                        size="small"
                        placeholder="e.g. TS-001"
                        disabled={draftOf(sku).ignored}
                        value={draftOf(sku).targetSku}
                        onChange={(event) => setField(sku, "targetSku", event.target.value)}
                      />
                    ),
                  },
                  {
                    title: "Item name",
                    key: "itemName",
                    render: (_, { sku }: { sku: string }) => (
                      <Input
                        size="small"
                        placeholder="e.g. T-Shirt, Black, M"
                        disabled={draftOf(sku).ignored}
                        value={draftOf(sku).itemName}
                        onChange={(event) => setField(sku, "itemName", event.target.value)}
                      />
                    ),
                  },
                  {
                    title: "Ignore",
                    key: "ignored",
                    width: 64,
                    align: "center",
                    render: (_, { sku }: { sku: string }) => (
                      <Switch
                        size="small"
                        checked={draftOf(sku).ignored}
                        onChange={(checked) => setIgnored(sku, checked)}
                      />
                    ),
                  },
                ]}
              />

              <Alert
                type="info"
                showIcon
                message="Saved the same way as Settings → SKU mapping"
                description="Nothing about this report is special-cased — a SKU mapped once covers every future period, so this list gets shorter as the catalogue fills in."
              />

              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                  {decided} of {skus.length} decided
                </Typography.Text>
                <Space>
                  <Button onClick={onCancel} disabled={saving}>
                    Cancel
                  </Button>
                  <Button
                    type="primary"
                    loading={saving}
                    disabled={decided < skus.length}
                    onClick={onSave}
                  >
                    Save &amp; build
                  </Button>
                </Space>
              </Space>
            </>
          ) : (
            <>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {skus.map((sku) => (
                  <li key={sku}>
                    <Typography.Text code>{sku}</Typography.Text>
                  </li>
                ))}
              </ul>
              <Typography.Text type="secondary">
                Only the owner can add a SKU mapping.{" "}
                <Link href="/settings?tab=sku">Settings &rarr; SKU mapping</Link> lists what is
                there today.
              </Typography.Text>
              <Space style={{ width: "100%", justifyContent: "flex-end" }}>
                <Button onClick={onCancel}>Close</Button>
              </Space>
            </>
          )}
        </Space>
      ) : null}
    </Modal>
  );
}

const SCHEME_OPTIONS = [
  { value: "REGULAR", label: "REGULAR" },
  { value: "UNION-OSS", label: "UNION-OSS" },
];

/**
 * Stops a build that found an Allegro settlement currency with no rule in
 * currency_map yet — Allegro writes the currency next to the amount rather
 * than in its own column, so a currency the reports have never seen before
 * still parses cleanly and would otherwise just be skipped, silently. Mirrors
 * `SkuGateModal` exactly: same shape, same "only the owner can save" split,
 * saved through the same form Settings → Channel rules uses.
 */
function CurrencyGateModal({
  gate,
  drafts,
  setDrafts,
  canEdit,
  saving,
  onCancel,
  onSave,
}: {
  gate: { card: BuildCard; periodLabel: string; currencies: string[] } | null;
  drafts: Record<string, { country: string; scheme: string; sellerVat: string }>;
  setDrafts: (
    updater: (
      drafts: Record<string, { country: string; scheme: string; sellerVat: string }>,
    ) => Record<string, { country: string; scheme: string; sellerVat: string }>,
  ) => void;
  canEdit: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const currencies = gate?.currencies ?? [];

  const draftOf = (currency: string) =>
    drafts[currency] ?? { country: "", scheme: "UNION-OSS", sellerVat: "" };

  const decided = currencies.filter((currency) => {
    const draft = draftOf(currency);

    return draft.country.trim() !== "" && draft.sellerVat.trim() !== "";
  }).length;

  const setField = (
    currency: string,
    field: "country" | "scheme" | "sellerVat",
    value: string,
  ) => setDrafts((current) => ({ ...current, [currency]: { ...draftOf(currency), [field]: value } }));

  return (
    <Modal
      title={
        currencies.length === 1
          ? "Map this currency before the report builds"
          : `Map ${currencies.length} currencies before the report builds`
      }
      open={gate !== null}
      onCancel={onCancel}
      footer={null}
      destroyOnHidden
      width={640}
    >
      {gate ? (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            {currencies.length === 1 ? "This currency appears" : "These currencies appear"} in{" "}
            {gate.periodLabel}&rsquo;s Allegro rows and{" "}
            {currencies.length === 1 ? "isn&rsquo;t" : "aren&rsquo;t"} in currency_map yet. Give{" "}
            {currencies.length === 1 ? "it" : "each one"} an arrival country, a VAT scheme and the
            seller VAT number it settles under.
          </Typography.Text>

          {canEdit ? (
            <>
              <Table
                dataSource={currencies.map((currency) => ({ currency }))}
                rowKey="currency"
                size="small"
                pagination={false}
                columns={[
                  {
                    title: "Currency",
                    dataIndex: "currency",
                    width: 100,
                    render: (currency: string) => <Typography.Text code>{currency}</Typography.Text>,
                  },
                  {
                    title: "Arrival country",
                    key: "country",
                    render: (_, { currency }: { currency: string }) => (
                      <Input
                        size="small"
                        placeholder="e.g. PL"
                        value={draftOf(currency).country}
                        onChange={(event) => setField(currency, "country", event.target.value)}
                      />
                    ),
                  },
                  {
                    title: "Scheme",
                    key: "scheme",
                    width: 150,
                    render: (_, { currency }: { currency: string }) => (
                      <Select
                        size="small"
                        style={{ width: "100%" }}
                        value={draftOf(currency).scheme}
                        options={SCHEME_OPTIONS}
                        onChange={(value) => setField(currency, "scheme", value)}
                      />
                    ),
                  },
                  {
                    title: "Seller VAT",
                    key: "sellerVat",
                    render: (_, { currency }: { currency: string }) => (
                      <Input
                        size="small"
                        placeholder="e.g. EE102013089"
                        value={draftOf(currency).sellerVat}
                        onChange={(event) => setField(currency, "sellerVat", event.target.value)}
                      />
                    ),
                  },
                ]}
              />

              <Alert
                type="info"
                showIcon
                message="Saved the same way as Settings → Channel rules"
                description="A currency mapped once covers every future period, so this list gets shorter as the map fills in."
              />

              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                  {decided} of {currencies.length} decided
                </Typography.Text>
                <Space>
                  <Button onClick={onCancel} disabled={saving}>
                    Cancel
                  </Button>
                  <Button
                    type="primary"
                    loading={saving}
                    disabled={decided < currencies.length}
                    onClick={onSave}
                  >
                    Save &amp; build
                  </Button>
                </Space>
              </Space>
            </>
          ) : (
            <>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {currencies.map((currency) => (
                  <li key={currency}>
                    <Typography.Text code>{currency}</Typography.Text>
                  </li>
                ))}
              </ul>
              <Typography.Text type="secondary">
                Only the owner can add a currency mapping.{" "}
                <Link href="/settings?tab=rules">Settings &rarr; Channel rules</Link> lists what is
                there today.
              </Typography.Text>
              <Space style={{ width: "100%", justifyContent: "flex-end" }}>
                <Button onClick={onCancel}>Close</Button>
              </Space>
            </>
          )}
        </Space>
      ) : null}
    </Modal>
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
