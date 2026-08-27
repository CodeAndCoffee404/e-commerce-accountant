"use client";

import { DownloadOutlined, WarningOutlined } from "@ant-design/icons";
import { Button, Empty, Select, Space, Switch, Table, Tag, theme, Tooltip, Typography } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import type { FilterOptions, TransactionPage, TransactionRow } from "@/lib/transactions/queries";

import { SourceDrawer } from "./source-drawer";

const DATASET_LABELS: Record<string, string> = {
  amazon_vat: "Amazon VAT",
  amazon_monthly: "Amazon Monthly",
  allegro: "Allegro",
  cdiscount: "Cdiscount",
  cdiscount_orders: "Cdiscount Orders",
  shopify: "Shopify",
};

export function TransactionsView({
  page,
  options,
  totals,
}: {
  page: TransactionPage;
  options: FilterOptions;
  totals: { currency: string; gross: string; vat: string; net: string; rows: number }[];
}) {
  const router = useRouter();
  // Read from the theme: a hard-coded amber stayed the light-mode shade on a
  // dark background.
  const { token } = theme.useToken();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [drilling, setDrilling] = useState<string | null>(null);
  const hasFilters = ["dataset", "period", "country", "type", "attention"].some((key) =>
    params.get(key),
  );

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());

    if (value === null || value === "") next.delete(key);
    else next.set(key, value);

    // Any filter change invalidates the current page number.
    if (key !== "page") next.delete("page");

    startTransition(() => router.push(`/transactions?${next.toString()}`));
  };

  const selector = (key: string, placeholder: string, values: string[], labels?: Record<string, string>) => (
    <Select
      allowClear
      showSearch
      style={{ minWidth: 170 }}
      placeholder={placeholder}
      value={params.get(key) ?? undefined}
      onChange={(value) => update(key, value ?? null)}
      options={values.map((value) => ({ value, label: labels?.[value] ?? value }))}
    />
  );

  return (
    <>
      <SourceDrawer transactionId={drilling} onClose={() => setDrilling(null)} />

      <Space wrap style={{ marginBottom: 16 }}>
        {selector("dataset", "Channel", options.datasets, DATASET_LABELS)}
        {selector("period", "Period", options.periods)}
        {selector("country", "Country", options.countries)}
        {selector("type", "Type", options.types)}

        <Space>
          <Switch
            checked={params.get("attention") === "1"}
            onChange={(checked) => update("attention", checked ? "1" : null)}
          />
          <Tooltip title="Rows where a number or a date could not be read. Fix them in the source file and upload it again — values are never edited here.">
            <Typography.Text>Needs attention</Typography.Text>
          </Tooltip>
        </Space>

        <Tooltip title="Downloads exactly what these filters show, as CSV.">
          <Button
            icon={<DownloadOutlined />}
            href={`/api/transactions/export?${params.toString()}`}
            download
          >
            Export
          </Button>
        </Tooltip>

        <Space>
          <Switch
            checked={params.get("superseded") === "1"}
            onChange={(checked) => update("superseded", checked ? "1" : null)}
          />
          <Tooltip title="Rows replaced by a later upload of the same period. Kept so older reports stay traceable.">
            <Typography.Text>Include superseded</Typography.Text>
          </Tooltip>
        </Space>
      </Space>

      {totals.length > 0 ? (
        <Space wrap style={{ marginBottom: 16 }} align="center">
          <Tooltip title="Totals for the current filter, one line per currency. Currencies are never added together.">
            <Typography.Text type="secondary">Totals</Typography.Text>
          </Tooltip>
          {totals.map((total) => (
            <Tag key={total.currency} style={{ padding: "4px 10px" }}>
              <b>{total.currency}</b> · gross {trim(total.gross)} · VAT {trim(total.vat)} ·{" "}
              {total.rows} rows
            </Tag>
          ))}
        </Space>
      ) : null}

      <Table<TransactionRow>
        dataSource={page.rows}
        rowKey="id"
        size="small"
        loading={pending}
        scroll={{ x: 1200 }}
        locale={{
          emptyText: (
            <Empty
              description={
                page.total === 0 && !hasFilters ? (
                  <span>
                    The ledger is empty.
                    <br />
                    Upload an export and its rows will appear here.
                  </span>
                ) : (
                  "No transactions match these filters"
                )
              }
            />
          ),
        }}
        pagination={{
          current: page.page,
          pageSize: page.pageSize,
          total: page.total,
          showSizeChanger: false,
          showTotal: (total) => `${total} transactions`,
          onChange: (next) => update("page", String(next)),
        }}
        rowClassName={(row) => (row.isCurrent ? "" : "ea-superseded")}
        columns={[
          {
            title: "Date",
            dataIndex: "occurredOn",
            width: 110,
            render: (value: string | null) => value ?? "—",
          },
          {
            title: "Channel",
            dataIndex: "dataset",
            width: 140,
            render: (value: string, row) => (
              <Space size={4}>
                {DATASET_LABELS[value] ?? value}
                {row.countryCode ? <Tag>{row.countryCode}</Tag> : null}
              </Space>
            ),
          },
          {
            title: (
              <Tooltip title="Inherited from the file, not derived per row. Reports select on it.">
                Period
              </Tooltip>
            ),
            dataIndex: "periodLabel",
            width: 140,
          },
          {
            title: "Type",
            dataIndex: "transactionType",
            width: 150,
            ellipsis: true,
            render: (value: string | null) => value ?? "—",
          },
          { title: "SKU", dataIndex: "sku", width: 170, ellipsis: true },
          {
            title: (
              <Tooltip title="The amount as the channel reported it, tax included. Refunds are negative in every channel.">
                Gross
              </Tooltip>
            ),
            dataIndex: "gross",
            align: "right",
            width: 120,
            render: (value: string | null, row) => money(value, row.currency),
          },
          {
            title: "VAT",
            dataIndex: "vatAmount",
            align: "right",
            width: 110,
            render: (value: string | null, row) => money(value, row.currency),
          },
          {
            title: "Net",
            dataIndex: "netAmount",
            align: "right",
            width: 120,
            render: (value: string | null, row) => money(value, row.currency),
          },
          {
            title: "",
            key: "flags",
            width: 44,
            render: (_, row) =>
              row.needsAttention ? (
                <Tooltip title={row.attentionReason ?? "Needs attention"}>
                  <WarningOutlined style={{ color: token.colorWarning }} />
                </Tooltip>
              ) : null,
          },
          {
            title: "",
            key: "source",
            width: 90,
            render: (_, row) => (
              <Tooltip title="Open the original file row this figure came from.">
                <Button size="small" onClick={() => setDrilling(row.id)}>
                  Source
                </Button>
              </Tooltip>
            ),
          },
        ]}
      />
    </>
  );
}

/** Postgres numeric arrives as a string; keeping it one avoids a float round-trip. */
function trim(value: string): string {
  return value.includes(".") ? value.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1") : value;
}

function money(value: string | null, currency: string | null) {
  if (value === null) return <Typography.Text type="secondary">—</Typography.Text>;

  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {trim(value)}
      {currency ? <Typography.Text type="secondary"> {currency}</Typography.Text> : null}
    </span>
  );
}
