"use client";

import { useState } from "react";

import { App, Button, Card, Descriptions, Form, Input, Space, Typography } from "antd";

import { renameCompany } from "@/lib/company/actions";
import type { CompanyIdentity } from "@/lib/company/queries";

/**
 * The company's own name, and the identifier that is not it.
 *
 * Showing both is the point. The name is editable, so it cannot be what
 * anything is keyed to; the identifier below it is what the rows, the folders
 * and the access list actually point at, and it is the thing to quote when
 * something has to be looked up by hand.
 */
export function CompanyCard({
  identity,
  isOwner,
}: {
  identity: CompanyIdentity;
  isOwner: boolean;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  return (
    <Card size="small">
      <Form
        form={form}
        layout="inline"
        initialValues={{ name: identity.name }}
        style={{ rowGap: 8, marginBottom: 16 }}
        onFinish={async (values) => {
          setSaving(true);

          try {
            const result = await renameCompany(values);

            if (result.ok) message.success(result.message);
            else message.error(result.message, 6);
          } finally {
            setSaving(false);
          }
        }}
      >
        <Form.Item
          name="name"
          label="Name"
          rules={[{ required: true, message: "A company name is required." }]}
        >
          <Input style={{ minWidth: 260 }} disabled={!isOwner} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} disabled={!isOwner}>
            Save
          </Button>
        </Form.Item>
      </Form>

      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label="Identifier">
          <Typography.Text code copyable>
            {identity.id}
          </Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="Report profile">
          <Typography.Text code>{identity.profileKey}</Typography.Text>
        </Descriptions.Item>
      </Descriptions>

      <Space style={{ marginTop: 12 }}>
        <Typography.Text type="secondary">
          {isOwner
            ? "Renaming changes what this company is called and nothing else — its files, reports and team all follow the identifier."
            : "Only an owner can rename the company."}
        </Typography.Text>
      </Space>
    </Card>
  );
}
