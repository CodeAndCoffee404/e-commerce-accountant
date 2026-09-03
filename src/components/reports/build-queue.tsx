"use client";

import { App, Alert, Button, Input, Modal, Select, Space, Switch, Table, Tooltip, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { saveAllegroCurrency, saveSkuMapping } from "@/lib/reference/actions";
import { buildReport } from "@/lib/reports/actions";
import type { ReportTypeId } from "@/lib/reports/definitions";

/**
 * Which channel's SKU mapping a report's unmapped-SKU gate saves into — the
 * gate itself is generic, but a saved mapping still has to land under the
 * right channel.
 */
export const SKU_MAPPING_CHANNEL: Partial<Record<ReportTypeId, string>> = {
  amazon_zoho_invoice: "amazon",
  allegro_zoho_invoice: "allegro",
  shopify_zoho_invoice: "shopify_geyser",
};

export const SKU_MAPPING_CHANNEL_LABEL: Partial<Record<ReportTypeId, string>> = {
  amazon_zoho_invoice: "Amazon",
  allegro_zoho_invoice: "Allegro",
  shopify_zoho_invoice: "Shopify Geyser",
};

/** One (report, period) a build is requested for — the unit the build queue moves in. */
export type Target = { reportType: ReportTypeId; periodLabel: string; variant?: string; label: string };

export const targetKey = (target: Target) =>
  `${target.reportType}:${target.variant ?? ""}|${target.periodLabel}`;

/**
 * Drives a queue of builds one at a time — the same machinery for a single
 * row's Build button (a queue of one) and for a "build everything ready"
 * shortcut. When a build refuses on unmapped SKUs or an unmapped currency,
 * the queue pauses on a form instead of erroring out; saving it re-attempts
 * that same target and then carries on with what was left.
 *
 * Shared by the Reports screen and the dashboard's own Build button, so a
 * mapping gate opens inline wherever a build was started from — it used to
 * exist only on Reports, and a build kicked off from the dashboard would
 * just fail with a message instead.
 */
export function useBuildQueue({
  canEditSkuMappings,
  canEditCurrencyMappings,
}: {
  canEditSkuMappings: boolean;
  canEditCurrencyMappings: boolean;
}) {
  const router = useRouter();
  const { message } = App.useApp();

  const queueRef = useRef<Target[]>([]);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueDone, setQueueDone] = useState(0);
  // Which control asked for the work now in the queue. A row's Build and a
  // "build everything" shortcut share this queue, and each should show its
  // own progress rather than the other's.
  const [queueSource, setQueueSource] = useState<string | null>(null);

  const [skuGate, setSkuGate] = useState<{ target: Target; skus: string[] } | null>(null);
  const [skuDrafts, setSkuDrafts] = useState<
    Record<string, { targetSku: string; itemName: string; ignored: boolean }>
  >({});
  const [savingSkus, setSavingSkus] = useState(false);

  const [currencyGate, setCurrencyGate] = useState<{ target: Target; currencies: string[] } | null>(
    null,
  );
  const [currencyDrafts, setCurrencyDrafts] = useState<
    Record<string, { country: string; scheme: string; sellerVat: string }>
  >({});
  const [savingCurrencies, setSavingCurrencies] = useState(false);

  const advanceQueue = () => {
    const next = queueRef.current.shift();

    if (!next) {
      setRunningKey(null);
      setQueueTotal(0);
      setQueueDone(0);
      setQueueSource(null);
      router.refresh();
      return;
    }

    void runTarget(next);
  };

  async function runTarget(target: Target): Promise<void> {
    setRunningKey(targetKey(target));

    try {
      const result = await buildReport({
        reportType: target.reportType,
        periodLabel: target.periodLabel,
        ...(target.variant ? { variant: target.variant } : {}),
      });

      if (result.ok) {
        message.success(`${target.label}: ${result.message}`, 6);
      } else if (result.needsSkuMapping && result.needsSkuMapping.length > 0) {
        // A form to fill in, not an error to read — the queue pauses here
        // until it is saved, then re-attempts this same target.
        setSkuGate({ target, skus: result.needsSkuMapping });
        setSkuDrafts({});
        return;
      } else if (result.needsCurrencyMapping && result.needsCurrencyMapping.length > 0) {
        setCurrencyGate({ target, currencies: result.needsCurrencyMapping });
        setCurrencyDrafts({});
        return;
      } else {
        // Ten seconds: it names the rule or the upload that is missing,
        // which is not readable in three.
        message.error(`${target.label}: ${result.message}`, 10);
      }
    } catch {
      message.error(
        "The server could not be reached — nothing was changed. Check the connection and try again.",
        8,
      );
    }

    setQueueDone((done) => done + 1);
    advanceQueue();
  }

  const startQueue = (targets: Target[], source?: string) => {
    if (targets.length === 0) return;

    if (runningKey === null) {
      queueRef.current = targets.slice(1);
      setQueueTotal(targets.length);
      setQueueDone(0);
      setQueueSource(source ?? null);
      void runTarget(targets[0]);
      return;
    }

    // A queue is already moving. Refusing the click would make the second
    // button look broken — it lights up, nothing happens — so what is asked
    // for joins the queue instead, minus anything already in it. Builds still
    // run one at a time; only the way they are asked for has changed.
    const queued = new Set([runningKey, ...queueRef.current.map(targetKey)]);
    const extra = targets.filter((target) => !queued.has(targetKey(target)));

    if (extra.length === 0) return;

    queueRef.current.push(...extra);
    setQueueTotal((total) => total + extra.length);
    setQueueSource(source ?? null);
  };

  const cancelQueue = () => {
    queueRef.current = [];
    setSkuGate(null);
    setCurrencyGate(null);
    setRunningKey(null);
    setQueueTotal(0);
    setQueueDone(0);
    setQueueSource(null);
  };

  // Leaves this one target unbuilt — nothing is saved, nothing is mapped —
  // and moves on to whatever is left in the queue, rather than abandoning
  // the whole batch over the one report that needs a decision first.
  const skipSku = () => {
    if (!skuGate) return;

    setSkuGate(null);
    setQueueDone((done) => done + 1);
    advanceQueue();
  };

  const skipCurrency = () => {
    if (!currencyGate) return;

    setCurrencyGate(null);
    setQueueDone((done) => done + 1);
    advanceQueue();
  };

  const saveSkusAndBuild = () => {
    if (!skuGate) return;

    setSavingSkus(true);
    const channel = SKU_MAPPING_CHANNEL[skuGate.target.reportType] ?? "amazon";

    void (async () => {
      try {
        for (const sku of skuGate.skus) {
          const draft = skuDrafts[sku];
          const ignored = draft?.ignored ?? false;

          const result = await saveSkuMapping({
            channel,
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

        const target = skuGate.target;

        setSkuGate(null);
        await runTarget(target);
      } catch {
        message.error(
          "The server could not be reached — nothing was changed. Check the connection and try again.",
          8,
        );
      } finally {
        setSavingSkus(false);
      }
    })();
  };

  const saveCurrenciesAndBuild = () => {
    if (!currencyGate) return;

    setSavingCurrencies(true);

    void (async () => {
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

        const target = currencyGate.target;

        setCurrencyGate(null);
        await runTarget(target);
      } catch {
        message.error(
          "The server could not be reached — nothing was changed. Check the connection and try again.",
          8,
        );
      } finally {
        setSavingCurrencies(false);
      }
    })();
  };

  return {
    startQueue,
    runningKey,
    queueTotal,
    queueDone,
    queueSource,
    busy: runningKey !== null,
    modals: (
      <>
        <SkuGateModal
          gate={skuGate}
          drafts={skuDrafts}
          setDrafts={setSkuDrafts}
          canEdit={canEditSkuMappings}
          saving={savingSkus}
          onCancel={cancelQueue}
          onSkip={skipSku}
          onSave={saveSkusAndBuild}
        />
        <CurrencyGateModal
          gate={currencyGate}
          drafts={currencyDrafts}
          setDrafts={setCurrencyDrafts}
          canEdit={canEditCurrencyMappings}
          saving={savingCurrencies}
          onCancel={cancelQueue}
          onSkip={skipCurrency}
          onSave={saveCurrenciesAndBuild}
        />
      </>
    ),
  };
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
  onSkip,
  onSave,
}: {
  gate: { target: Target; skus: string[] } | null;
  drafts: Record<string, { targetSku: string; itemName: string; ignored: boolean }>;
  setDrafts: (
    updater: (
      drafts: Record<string, { targetSku: string; itemName: string; ignored: boolean }>,
    ) => Record<string, { targetSku: string; itemName: string; ignored: boolean }>,
  ) => void;
  canEdit: boolean;
  saving: boolean;
  onCancel: () => void;
  /** Leaves this report unbuilt and moves on to the rest of the queue. */
  onSkip: () => void;
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
            {skus.length === 1 ? "This SKU appears" : "These SKUs appear"} in {gate.target.periodLabel}
            &rsquo;s {SKU_MAPPING_CHANNEL_LABEL[gate.target.reportType] ?? "Amazon"} rows and{" "}
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
                    Cancel build
                  </Button>
                  <Tooltip title="Leaves this report unbuilt for now and moves on to the rest of the queue.">
                    <Button onClick={onSkip} disabled={saving}>
                      Skip this report
                    </Button>
                  </Tooltip>
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
                <Button onClick={onCancel}>Cancel build</Button>
                <Tooltip title="Leaves this report unbuilt for now and moves on to the rest of the queue.">
                  <Button onClick={onSkip}>Skip this report</Button>
                </Tooltip>
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
  onSkip,
  onSave,
}: {
  gate: { target: Target; currencies: string[] } | null;
  drafts: Record<string, { country: string; scheme: string; sellerVat: string }>;
  setDrafts: (
    updater: (
      drafts: Record<string, { country: string; scheme: string; sellerVat: string }>,
    ) => Record<string, { country: string; scheme: string; sellerVat: string }>,
  ) => void;
  canEdit: boolean;
  saving: boolean;
  onCancel: () => void;
  /** Leaves this report unbuilt and moves on to the rest of the queue. */
  onSkip: () => void;
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
            {gate.target.periodLabel}&rsquo;s Allegro rows and{" "}
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
                    Cancel build
                  </Button>
                  <Tooltip title="Leaves this report unbuilt for now and moves on to the rest of the queue.">
                    <Button onClick={onSkip} disabled={saving}>
                      Skip this report
                    </Button>
                  </Tooltip>
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
                <Button onClick={onCancel}>Cancel build</Button>
                <Tooltip title="Leaves this report unbuilt for now and moves on to the rest of the queue.">
                  <Button onClick={onSkip}>Skip this report</Button>
                </Tooltip>
              </Space>
            </>
          )}
        </Space>
      ) : null}
    </Modal>
  );
}
