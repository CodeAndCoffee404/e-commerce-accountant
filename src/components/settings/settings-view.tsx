"use client";

import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  deleteSkuMapping,
  deleteVatRate,
  refreshRates,
  restoreDefaults,
  saveChannelRule,
  saveSkuMapping,
  saveVatRate,
  type ActionResult,
} from "@/lib/reference/actions";
import { useSearchParams } from "next/navigation";

import type { AuditRow } from "@/lib/audit/record";
import type { ConnectionSummary } from "@/lib/google/connection";
import type { Member } from "@/lib/members/queries";
import type { ReferenceData } from "@/lib/reference/queries";
import type { AllReportSettings } from "@/lib/reports/settings";

import { AuditCard } from "./audit-card";
import { DriveCard } from "./drive-card";
import { MembersCard } from "./members-card";
import { ReportSettingsTab } from "./report-settings";

type VatRate = ReferenceData["vatRates"][number];
type SkuMapping = ReferenceData["skuMappings"][number];

export function SettingsView({
  data,
  reports,
  connection,
  pickerApiKey,
  members,
  selfEmail,
  audit,
  canEdit,
  isOwner,
}: {
  data: ReferenceData;
  reports: AllReportSettings;
  connection: ConnectionSummary | null;
  pickerApiKey: string | null;
  members: Member[];
  selfEmail: string;
  audit: AuditRow[];
  canEdit: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { message } = App.useApp();
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<ActionResult>) => {
    startTransition(async () => {
      try {
        const result = await action();

        if (result.ok) message.success(result.message);
        else message.error(result.message, 6);
      } catch {
        message.error("The server could not be reached — nothing was changed. Check the connection and try again.", 8);
      }

      router.refresh();
    });
  };

  // Deep-linkable, and the OAuth callback's ?drive= outcome must land on the
  // tab that can show it.
  const requestedTab = params.get("tab") ?? (params.get("drive") ? "drive" : "reports");

  return (
    <Tabs
      defaultActiveKey={requestedTab}
      items={[
        {
          key: "reports",
          label: "Reports",
          children: (
            <ReportSettingsTab settings={reports} canEdit={canEdit} run={run} pending={pending} />
          ),
        },
        {
          key: "vat",
          label: "VAT rates",
          children: <VatRates data={data.vatRates} canEdit={canEdit} run={run} pending={pending} />,
        },
        {
          key: "sku",
          label: "SKU mapping",
          children: <Skus data={data.skuMappings} canEdit={canEdit} run={run} pending={pending} />,
        },
        {
          key: "seller",
          label: "Seller VAT",
          children: <SellerVat data={data.sellerVatNumbers} />,
        },
        {
          key: "fx",
          label: "Exchange rates",
          children: <Fx data={data.fx} canEdit={canEdit} run={run} pending={pending} />,
        },
        {
          key: "rules",
          label: "Channel rules",
          children: (
            <Rules
              // The "reports" channel is report configuration with its own tab
              // above; offering the same rows as raw JSON here would create two
              // editors for one thing.
              data={data.channelRules.filter((rule) => rule.channel !== "reports")}
              canEdit={canEdit}
              run={run}
              pending={pending}
            />
          ),
        },
        {
          key: "drive",
          label: "Google Drive",
          children: <DriveCard connection={connection} apiKey={pickerApiKey} canEdit={canEdit} />,
        },
        {
          key: "team",
          label: "Team",
          children: <MembersCard members={members} isOwner={isOwner} selfEmail={selfEmail} />,
        },
        {
          key: "activity",
          label: "Activity",
          children: <AuditCard rows={audit} />,
        },
      ]}
    />
  );
}

type Runner = (action: () => Promise<ActionResult>) => void;

function VatRates({
  data,
  canEdit,
  run,
  pending,
}: {
  data: VatRate[];
  canEdit: boolean;
  run: Runner;
  pending: boolean;
}) {
  const [editing, setEditing] = useState<Partial<VatRate> | null>(null);

  return (
    <>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button
          type="primary"
          disabled={!canEdit}
          onClick={() => setEditing({ validFrom: new Date().toISOString().slice(0, 10) })}
        >
          Add rate
        </Button>
        <Typography.Text type="secondary">
          A rate applies from its start date onwards, so recalculating an old month uses the rate
          that applied then. To change a rate, add a new row with the date it takes effect rather
          than editing the old one.
        </Typography.Text>
      </Space>

      <Table<VatRate>
        dataSource={data}
        rowKey="id"
        size="small"
        pagination={false}
        loading={pending}
        scroll={{ x: 760 }}
        columns={[
          { title: "Country", dataIndex: "country", width: 90 },
          {
            title: "Rate",
            dataIndex: "rate",
            width: 90,
            render: (value: string) => `${value} %`,
          },
          { title: "From", dataIndex: "validFrom", width: 120 },
          {
            title: "To",
            dataIndex: "validTo",
            width: 120,
            render: (value: string | null) =>
              value ?? <Typography.Text type="secondary">in force</Typography.Text>,
          },
          { title: "Note", dataIndex: "note", ellipsis: true },
          {
            title: "",
            key: "actions",
            width: 140,
            render: (_, row) => (
              <Space>
                <Button size="small" disabled={!canEdit} onClick={() => setEditing(row)}>
                  Edit
                </Button>
                <Popconfirm
                  title="Delete this rate?"
                  onConfirm={() => run(() => deleteVatRate(row.id))}
                  disabled={!canEdit}
                >
                  <Button size="small" danger disabled={!canEdit}>
                    Delete
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <EditModal
        title="VAT rate"
        open={editing !== null}
        initial={editing}
        onClose={() => setEditing(null)}
        onSubmit={(values) => run(() => saveVatRate({ ...values, id: editing?.id }))}
        fields={[
          { name: "country", label: "Country code", required: true, placeholder: "DE" },
          { name: "rate", label: "Rate, %", required: true, placeholder: "19" },
          { name: "validFrom", label: "Valid from", required: true, placeholder: "2026-01-01" },
          { name: "validTo", label: "Valid to", placeholder: "empty while in force" },
          { name: "note", label: "Note" },
        ]}
      />
    </>
  );
}

function Skus({
  data,
  canEdit,
  run,
  pending,
}: {
  data: SkuMapping[];
  canEdit: boolean;
  run: Runner;
  pending: boolean;
}) {
  const [editing, setEditing] = useState<Partial<SkuMapping> | null>(null);

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          disabled={!canEdit}
          onClick={() => setEditing({ channel: "amazon", isIgnored: false })}
        >
          Add SKU
        </Button>
        <Typography.Text type="secondary">
          Maps a channel SKU to the name and code the invoice should carry. An unmapped SKU still
          reaches the invoice under its raw code. Ignored ones are sold but never invoiced.
        </Typography.Text>
      </Space>

      <Table<SkuMapping>
        dataSource={data}
        rowKey="id"
        size="small"
        pagination={false}
        loading={pending}
        scroll={{ x: 900 }}
        columns={[
          { title: "Channel", dataIndex: "channel", width: 100 },
          { title: "Source SKU", dataIndex: "sourceSku", width: 260 },
          {
            title: "Invoice SKU",
            dataIndex: "targetSku",
            render: (value: string | null) => value ?? "—",
          },
          {
            title: "Item name",
            dataIndex: "itemName",
            render: (value: string | null) => value ?? "—",
          },
          {
            title: "Ignored",
            dataIndex: "isIgnored",
            width: 90,
            render: (value: boolean) => (value ? <Tag color="orange">ignored</Tag> : null),
          },
          {
            title: "",
            key: "actions",
            width: 140,
            render: (_, row) => (
              <Space>
                <Button size="small" disabled={!canEdit} onClick={() => setEditing(row)}>
                  Edit
                </Button>
                <Popconfirm
                  title="Delete this mapping?"
                  onConfirm={() => run(() => deleteSkuMapping(row.id))}
                  disabled={!canEdit}
                >
                  <Button size="small" danger disabled={!canEdit}>
                    Delete
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <EditModal
        title="SKU mapping"
        open={editing !== null}
        initial={editing}
        onClose={() => setEditing(null)}
        onSubmit={(values) =>
          run(() =>
            saveSkuMapping({
              ...values,
              id: editing?.id,
              isIgnored: Boolean(values.isIgnored),
            }),
          )
        }
        fields={[
          { name: "channel", label: "Channel", required: true },
          { name: "sourceSku", label: "Source SKU", required: true },
          { name: "targetSku", label: "Invoice SKU" },
          { name: "itemName", label: "Item name" },
          { name: "isIgnored", label: "Ignored", type: "switch" },
        ]}
      />
    </>
  );
}

function Rules({
  data,
  canEdit,
  run,
  pending,
}: {
  data: ReferenceData["channelRules"];
  canEdit: boolean;
  run: Runner;
  pending: boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Typography.Paragraph type="secondary">
        How each channel is read: which country a currency implies, which arrival countries are
        skipped, what counts as a sale. These are assumptions as much as facts, which is why they
        are here rather than buried in the code. Edit as JSON — a malformed value is refused.
      </Typography.Paragraph>

      {data.map((rule) => {
        const stored = JSON.stringify(rule.value, null, 2);
        const draft = drafts[rule.id] ?? stored;

        return (
          <Card key={rule.id} size="small" title={`${rule.channel} · ${rule.key}`}>
            {rule.note ? (
              <Typography.Paragraph type="secondary">{rule.note}</Typography.Paragraph>
            ) : null}

            <Input.TextArea
              value={draft}
              autoSize={{ minRows: 3, maxRows: 16 }}
              disabled={!canEdit}
              style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 12 }}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [rule.id]: event.target.value }))
              }
            />

            <Space style={{ marginTop: 12 }}>
              <Button
                type="primary"
                size="small"
                disabled={!canEdit || draft === stored}
                loading={pending}
                onClick={() => run(() => saveChannelRule(rule.id, draft))}
              >
                Save
              </Button>
              <Button
                size="small"
                disabled={draft === stored}
                onClick={() =>
                  setDrafts((current) => {
                    const next = { ...current };
                    delete next[rule.id];
                    return next;
                  })
                }
              >
                Reset
              </Button>
            </Space>
          </Card>
        );
      })}
    </Space>
  );
}

function SellerVat({ data }: { data: ReferenceData["sellerVatNumbers"] }) {
  return (
    <>
    <Typography.Paragraph type="secondary">
      The registrations reports quote as the seller. Which one a row gets follows from the
      channel rule for its country and scheme.
    </Typography.Paragraph>

    <Table
      dataSource={data}
      rowKey="id"
      size="small"
      pagination={false}
      scroll={{ x: 640 }}
      columns={[
        { title: "Country", dataIndex: "country", width: 90 },
        { title: "VAT number", dataIndex: "vatNumber", width: 200 },
        { title: "From", dataIndex: "validFrom", width: 120 },
        { title: "Note", dataIndex: "note", ellipsis: true },
      ]}
    />
    </>
  );
}

function Fx({
  data,
  canEdit,
  run,
  pending,
}: {
  data: ReferenceData["fx"];
  canEdit: boolean;
  run: Runner;
  pending: boolean;
}) {
  return (
    <Card size="small">
      <Typography.Paragraph>
        European Central Bank reference rates, quoted against the euro. A report records the rate
        and the date it used, so regenerating it later produces the same numbers.
      </Typography.Paragraph>

      <Typography.Paragraph type="secondary">
        Cached days: <b>{data.days}</b>
        {data.latest ? (
          <>
            {" "}
            · latest <b>{data.latest}</b>
          </>
        ) : null}
        {data.currencies.length > 0 ? <> · {data.currencies.length} currencies</> : null}
      </Typography.Paragraph>

      <Space wrap>
        <Button type="primary" disabled={!canEdit} loading={pending} onClick={() => run(() => refreshRates(false))}>
          Refresh last 90 days
        </Button>
        <Button disabled={!canEdit} loading={pending} onClick={() => run(() => refreshRates(true))}>
          Load full history
        </Button>
        <Tooltip title="Adds back anything missing from the original rule set. Values you have edited are left as they are.">
          <Button disabled={!canEdit} loading={pending} onClick={() => run(() => restoreDefaults())}>
            Restore missing defaults
          </Button>
        </Tooltip>
      </Space>
    </Card>
  );
}

type Field = {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  type?: "switch";
};

function EditModal({
  title,
  open,
  initial,
  fields,
  onClose,
  onSubmit,
}: {
  title: string;
  open: boolean;
  initial: Record<string, unknown> | null;
  fields: Field[];
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const [form] = Form.useForm();

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      destroyOnHidden
      onOk={async () => {
        const values = await form.validateFields();

        onSubmit(values);
        onClose();
      }}
    >
      <Form form={form} layout="vertical" initialValues={initial ?? {}} preserve={false}>
        {fields.map((field) => (
          <Form.Item
            key={field.name}
            name={field.name}
            label={field.label}
            rules={field.required ? [{ required: true, message: `${field.label} is required` }] : []}
            valuePropName={field.type === "switch" ? "checked" : "value"}
          >
            {field.type === "switch" ? <Switch /> : <Input placeholder={field.placeholder} />}
          </Form.Item>
        ))}
      </Form>
    </Modal>
  );
}
