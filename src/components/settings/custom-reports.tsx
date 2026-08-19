"use client";

import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import { useState } from "react";

import type { ActionResult } from "@/lib/reference/actions";
import type { ReferenceData } from "@/lib/reference/queries";
import { deleteCustomReport, saveCustomReport } from "@/lib/reports/custom-actions";
import { DATASET_NAMES } from "@/modules/channels/registry";
import {
  customReportName,
  customSliceConfigSchema,
  describeConfig,
  SLICE_DIMENSIONS,
  SLICE_MEASURES,
  type CustomSliceConfig,
} from "@/modules/reports/custom-slice-config";

type Runner = (action: () => Promise<ActionResult>) => void;

type Definition = {
  key: string;
  name: string;
  /** Null when the stored value no longer parses; the row says so. */
  config: CustomSliceConfig | null;
};

/** What the form holds: the config with its filters flattened into fields. */
type FormValues = {
  name: string;
  groupBy: string[];
  measures: string[];
  datasets: string[];
  countries: string[];
  currencies: string[];
  transactionTypes: string[];
  skus: string[];
};

const EMPTY: FormValues = {
  name: "",
  groupBy: ["dataset"],
  measures: ["rows", "gross"],
  datasets: [],
  countries: [],
  currencies: [],
  transactionTypes: [],
  skus: [],
};

/**
 * The one report the client defines rather than requests: a slice of the
 * ledger — filters, groupings, sums. Safe to hand over because it can only
 * aggregate rows that are already counted; the arithmetic that decides what a
 * number *is* stays in code, verified against the reference reports.
 */
export function CustomReportsTab({
  rules,
  canEdit,
  run,
  pending,
}: {
  rules: ReferenceData["channelRules"];
  canEdit: boolean;
  run: Runner;
  pending: boolean;
}) {
  const [editing, setEditing] = useState<{ key?: string; values: FormValues } | null>(null);

  const definitions: Definition[] = rules
    .map((rule) => {
      const parsed = customSliceConfigSchema.safeParse(rule.value);

      return {
        key: rule.key,
        name: customReportName(rule.value, rule.key),
        config: parsed.success ? parsed.data : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const open = (definition?: Definition) => {
    if (!definition) {
      setEditing({ values: EMPTY });
      return;
    }

    const config = definition.config;

    setEditing({
      key: definition.key,
      values: config
        ? {
            name: config.name,
            groupBy: [...config.groupBy],
            measures: [...config.measures],
            datasets: [...config.filters.datasets],
            countries: [...config.filters.countries],
            currencies: [...config.filters.currencies],
            transactionTypes: [...config.filters.transactionTypes],
            skus: [...config.filters.skus],
          }
        : { ...EMPTY, name: definition.name },
    });
  };

  const save = (values: FormValues) => {
    const key = editing?.key;

    run(() =>
      saveCustomReport({
        ...(key ? { key } : {}),
        name: values.name,
        groupBy: values.groupBy,
        measures: values.measures,
        filters: {
          datasets: values.datasets,
          countries: values.countries,
          currencies: values.currencies,
          transactionTypes: values.transactionTypes,
          skus: values.skus,
        },
      }),
    );
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Your own summaries of the transaction ledger: pick what to count, how to group it and
        what to sum. Each definition gets its own card on Reports and builds like any other
        report — recorded, downloadable, delivered to Drive.
      </Typography.Paragraph>

      <Alert
        type="info"
        showIcon
        message="Informational, by design"
        description="A custom report totals rows that are already counted — it cannot touch VAT mathematics, exchange rates or refund signs, which stay in code and are verified line-by-line against reference reports. Use it for analysis and checks, not for filings."
      />

      <div>
        <Button type="primary" disabled={!canEdit} onClick={() => open()}>
          New custom report
        </Button>
      </div>

      <Table<Definition>
        dataSource={definitions}
        rowKey="key"
        size="small"
        pagination={false}
        loading={pending}
        scroll={{ x: 720 }}
        locale={{ emptyText: "No custom reports yet. The first one takes about a minute." }}
        columns={[
          { title: "Name", dataIndex: "name", width: 220 },
          {
            title: "What it does",
            key: "summary",
            render: (_, definition) =>
              definition.config ? (
                <Typography.Text type="secondary">
                  {describeConfig(definition.config, DATASET_NAMES)}
                </Typography.Text>
              ) : (
                <Typography.Text type="warning">
                  The stored definition is malformed — open it and save it again.
                </Typography.Text>
              ),
          },
          {
            title: "",
            key: "actions",
            width: 140,
            render: (_, definition) => (
              <Space>
                <Button size="small" disabled={!canEdit} onClick={() => open(definition)}>
                  Edit
                </Button>
                <Popconfirm
                  title="Delete this definition?"
                  description="Reports already built from it are kept."
                  disabled={!canEdit}
                  onConfirm={() => run(() => deleteCustomReport(definition.key))}
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

      <DefinitionModal
        open={editing !== null}
        initial={editing?.values ?? EMPTY}
        isNew={editing?.key === undefined}
        onClose={() => setEditing(null)}
        onSubmit={save}
      />
    </Space>
  );
}

function DefinitionModal({
  open,
  initial,
  isNew,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial: FormValues;
  isNew: boolean;
  onClose: () => void;
  onSubmit: (values: FormValues) => void;
}) {
  const [form] = Form.useForm<FormValues>();

  return (
    <Modal
      title={isNew ? "New custom report" : "Custom report"}
      open={open}
      onCancel={onClose}
      destroyOnHidden
      width={560}
      okText="Save"
      onOk={async () => {
        const values = await form.validateFields();

        onSubmit(values);
        onClose();
      }}
    >
      <Form form={form} layout="vertical" initialValues={initial} preserve={false}>
        <Form.Item
          name="name"
          label="Name"
          extra="Goes into the card, the filename and the sheet."
          rules={[
            { required: true, message: "Give the report a name." },
            { max: 60, message: "Keep the name under 60 characters." },
            {
              pattern: /^[^\\/:*?"<>|[\]]+$/,
              message: 'The name cannot contain \\ / : * ? " < > | [ ]',
            },
          ]}
        >
          <Input placeholder="Sales by country" />
        </Form.Item>

        <Form.Item
          name="groupBy"
          label="Group by"
          extra="One row per combination of these fields."
          rules={[{ required: true, message: "Group by at least one field." }]}
        >
          <Checkbox.Group
            options={SLICE_DIMENSIONS.map((dimension) => ({
              label: dimension.label,
              value: dimension.key,
            }))}
          />
        </Form.Item>

        <Form.Item
          name="measures"
          label="Show"
          extra="Sums per group. A row whose amount could not be read is counted in Rows and named in a warning, never summed as zero."
          rules={[{ required: true, message: "Show at least one value." }]}
        >
          <Checkbox.Group
            options={SLICE_MEASURES.map((measure) => ({
              label: measure.label,
              value: measure.key,
            }))}
          />
        </Form.Item>

        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
          Filters narrow what is counted; an empty filter means everything. Values are matched
          exactly, ignoring case — a country is PL, a currency EUR, a type whatever the export
          calls it (Vente, refund, …).
        </Typography.Paragraph>

        <Form.Item name="datasets" label="Channels" style={{ marginBottom: 12 }}>
          <Select
            mode="multiple"
            allowClear
            placeholder="Every channel"
            options={Object.entries(DATASET_NAMES).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>

        <Form.Item name="countries" label="Countries" style={{ marginBottom: 12 }}>
          <Select mode="tags" allowClear placeholder="Every country" tokenSeparators={[",", " "]} />
        </Form.Item>

        <Form.Item name="currencies" label="Currencies" style={{ marginBottom: 12 }}>
          <Select mode="tags" allowClear placeholder="Every currency" tokenSeparators={[",", " "]} />
        </Form.Item>

        <Form.Item name="transactionTypes" label="Types" style={{ marginBottom: 12 }}>
          <Select mode="tags" allowClear placeholder="Every type" tokenSeparators={[","]} />
        </Form.Item>

        <Form.Item name="skus" label="SKUs" style={{ marginBottom: 0 }}>
          <Select mode="tags" allowClear placeholder="Every SKU" tokenSeparators={[",", " "]} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
