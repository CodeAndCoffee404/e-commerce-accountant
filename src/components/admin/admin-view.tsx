"use client";

import { BankOutlined, LoginOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, Card, Form, Input, Select, Space, Table, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { createCompany, enterCompany } from "@/lib/admin/actions";
import type { CompanySummary } from "@/lib/admin/queries";
import { DEFAULT_ROUTE } from "@/lib/navigation";

/**
 * The list of companies, and the two things that can be done to it.
 *
 * Plain on purpose. It is a hallway, not a room: what matters is that the
 * names are unambiguous and that stepping into one is a deliberate act rather
 * than a click that could be mistaken for something else.
 */
export function AdminView({
  companies,
  current,
  profiles,
}: {
  companies: CompanySummary[];
  /** The profiles the code knows how to build reports for. */
  profiles: string[];
  /** The company this session is in, so the row you are already inside says so. */
  current: string;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const [pending, start] = useTransition();
  const [form] = Form.useForm();

  const run = (action: () => Promise<{ ok: boolean; message: string }>, then?: () => void) =>
    start(async () => {
      try {
        const result = await action();

        if (result.ok) {
          message.success(result.message, 6);
          then?.();
        } else {
          message.error(result.message, 8);
        }
      } catch {
        message.error(
          "The server could not be reached — nothing was changed. Check the connection and try again.",
          8,
        );
      }

      router.refresh();
    });

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ marginBottom: 0 }}>
        Companies
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Each keeps its own uploads, reports and settings, and cannot see another&apos;s. Stepping
        into one puts you in it as an owner, and its own owner sees you in their team list.
      </Typography.Paragraph>

      <Card size="small" variant="borderless">
        <Table<CompanySummary>
          rowKey="id"
          dataSource={companies}
          pagination={false}
          size="small"
          columns={[
            {
              title: "Company",
              dataIndex: "name",
              render: (name: string, row) => (
                <Space>
                  <BankOutlined />
                  <span>{name}</span>
                  {row.id === current ? <Tag color="blue">You are here</Tag> : null}
                </Space>
              ),
            },
            { title: "Short name", dataIndex: "slug" },
            { title: "People", dataIndex: "members", align: "right" },
            {
              title: "Last upload",
              dataIndex: "lastUploadAt",
              render: (at: Date | null) => (at ? new Date(at).toLocaleDateString() : "—"),
            },
            {
              title: "Last report",
              dataIndex: "lastReportAt",
              render: (at: Date | null) => (at ? new Date(at).toLocaleDateString() : "—"),
            },
            {
              title: "",
              key: "enter",
              align: "right",
              render: (_: unknown, row) =>
                row.id === current ? null : (
                  <Button
                    size="small"
                    icon={<LoginOutlined />}
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => enterCompany(row.id),
                        () => router.push(DEFAULT_ROUTE),
                      )
                    }
                  >
                    Work in this one
                  </Button>
                ),
            },
          ]}
        />
      </Card>

      <Card size="small" title="Add a company" variant="borderless">
        <Typography.Paragraph type="secondary">
          The address you give becomes its owner: they sign in with Google and find the company
          waiting, with the standard VAT rates and channel rules already in place.
        </Typography.Paragraph>

        <Form
          form={form}
          layout="inline"
          style={{ rowGap: 8 }}
          onFinish={(values) => run(() => createCompany(values), () => form.resetFields())}
        >
          <Form.Item name="name" rules={[{ required: true, message: "A name is required." }]}>
            <Input placeholder="Company name" style={{ minWidth: 200 }} />
          </Form.Item>
          <Form.Item
            name="slug"
            rules={[{ required: true, message: "A short name is required." }]}
            tooltip="Lower case, no spaces. It never changes and never appears to customers."
          >
            <Input placeholder="short-name" style={{ minWidth: 160 }} />
          </Form.Item>
          <Form.Item
            name="profileKey"
            rules={[{ required: true, message: "A profile is required." }]}
            tooltip="Which profile in the code its reports are built from. Added by a developer first."
          >
            <Select
              placeholder="Profile"
              style={{ minWidth: 140 }}
              options={profiles.map((key) => ({ value: key, label: key }))}
            />
          </Form.Item>
          <Form.Item
            name="adminEmail"
            rules={[{ required: true, type: "email", message: "A valid address is required." }]}
          >
            <Input placeholder="owner@example.com" style={{ minWidth: 220 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={pending}>
              Add
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </Space>
  );
}
