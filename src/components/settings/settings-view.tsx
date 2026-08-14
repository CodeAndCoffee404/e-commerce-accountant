"use client";

import { App, Button, Card, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
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
import type { ReferenceData } from "@/lib/reference/queries";

type VatRate = ReferenceData["vatRates"][number];
type SkuMapping = ReferenceData["skuMappings"][number];

export function SettingsView({ data, canEdit }: { data: ReferenceData; canEdit: boolean }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<ActionResult>) => {
    startTransition(async () => {
      const result = await action();

      if (result.ok) message.success(result.message);
      else message.error(result.message, 6);

      router.refresh();
    });
  };

  return (
    <Tabs
      items={[
        {
          key: "vat",
          label: "VAT rates",
          children: <VatRates data={data.vatRates} canEdit={canEdit} run={run} pending={pending} />,
        },
        {
          key: "sku",
          label: "SKU",
          children: <Skus data={data.skuMappings} canEdit={canEdit} run={run} pending={pending} />,
        },
        {
          key: "rules",
          label: "Channel rules",
          children: <Rules data={data.channelRules} canEdit={canEdit} run={run} pending={pending} />,
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
      <Space style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          disabled={!canEdit}
          onClick={() => setEditing({ validFrom: new Date().toISOString().slice(0, 10) })}
        >
          Add rate
        </Button>
      </Space>

      <Table<VatRate>
        dataSource={data}
        rowKey="id"
        size="small"
        pagination={false}
        loading={pending}
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
          Ignored SKUs are sold but never invoiced — the connectors.
        </Typography.Text>
      </Space>

      <Table<SkuMapping>
        dataSource={data}
        rowKey="id"
        size="small"
        pagination={false}
        loading={pending}
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
    <Table
      dataSource={data}
      rowKey="id"
      size="small"
      pagination={false}
      columns={[
        { title: "Country", dataIndex: "country", width: 90 },
        { title: "VAT number", dataIndex: "vatNumber", width: 200 },
        { title: "From", dataIndex: "validFrom", width: 120 },
        { title: "Note", dataIndex: "note", ellipsis: true },
      ]}
    />
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
        <Button disabled={!canEdit} loading={pending} onClick={() => run(() => restoreDefaults())}>
          Restore missing defaults
        </Button>
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
            rules={field.required ? [{ required: true, message: `${field.label} — обязательно` }] : []}
            valuePropName={field.type === "switch" ? "checked" : "value"}
          >
            {field.type === "switch" ? <Switch /> : <Input placeholder={field.placeholder} />}
          </Form.Item>
        ))}
      </Form>
    </Modal>
  );
}
