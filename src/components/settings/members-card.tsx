"use client";

import { App, Button, Card, Form, Input, Select, Table, Tag, Tooltip, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { inviteMember, updateMember } from "@/lib/members/actions";
import type { Member } from "@/lib/members/queries";

const ROLES = [
  { value: "owner", label: "Owner", hint: "Everything, including who else gets in." },
  { value: "accountant", label: "Accountant", hint: "Uploads, reports and reference data." },
  { value: "viewer", label: "Viewer", hint: "Can look, cannot change anything." },
];

export function MembersCard({ members, isOwner }: { members: Member[]; isOwner: boolean }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [pending, startTransition] = useTransition();
  const [form] = Form.useForm();

  const run = (action: () => Promise<{ ok: boolean; message: string }>) =>
    startTransition(async () => {
      const result = await action();

      if (result.ok) message.success(result.message, 6);
      else message.error(result.message, 8);

      router.refresh();
    });

  return (
    <Card size="small" title="Access">
      <Typography.Paragraph type="secondary">
        Google decides who a person is; this list decides whether they may come in. An address
        here can sign in with its Google account — no password is ever set.
      </Typography.Paragraph>

      {isOwner ? (
        <Form
          form={form}
          layout="inline"
          style={{ marginBottom: 16 }}
          initialValues={{ role: "accountant" }}
          onFinish={(values) =>
            run(async () => {
              const result = await inviteMember(values);

              if (result.ok) form.resetFields();

              return result;
            })
          }
        >
          <Form.Item name="email" rules={[{ required: true, message: "Email is required" }]}>
            <Input placeholder="name@company.com" style={{ minWidth: 240 }} />
          </Form.Item>
          <Form.Item name="role">
            <Select
              style={{ width: 160 }}
              options={ROLES.map(({ value, label }) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={pending}>
              Invite
            </Button>
          </Form.Item>
        </Form>
      ) : null}

      <Table<Member>
        dataSource={members}
        rowKey="id"
        size="small"
        pagination={false}
        loading={pending}
        columns={[
          {
            title: "Person",
            dataIndex: "email",
            render: (email: string, row) => (
              <div>
                <Typography.Text>{email}</Typography.Text>
                {row.name ? (
                  <>
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {row.name}
                    </Typography.Text>
                  </>
                ) : null}
              </div>
            ),
          },
          {
            title: (
              <Tooltip
                title={
                  <span>
                    {ROLES.map((role) => (
                      <span key={role.value}>
                        <b>{role.label}</b> — {role.hint}
                        <br />
                      </span>
                    ))}
                  </span>
                }
              >
                Role
              </Tooltip>
            ),
            dataIndex: "role",
            width: 170,
            render: (role: string, row) =>
              isOwner ? (
                <Select
                  size="small"
                  style={{ width: 140 }}
                  value={role}
                  options={ROLES.map(({ value, label }) => ({ value, label }))}
                  onChange={(next) => run(() => updateMember({ id: row.id, role: next }))}
                />
              ) : (
                <Tag>{role}</Tag>
              ),
          },
          {
            title: (
              <Tooltip title="Invited but never signed in yet — the invitation is waiting.">
                Joined
              </Tooltip>
            ),
            dataIndex: "joinedAt",
            width: 180,
            render: (value: Date | null) =>
              value ? (
                new Date(value).toLocaleString("en-GB")
              ) : (
                <Typography.Text type="secondary">not yet</Typography.Text>
              ),
          },
          {
            title: "",
            key: "actions",
            width: 120,
            render: (_, row) =>
              isOwner ? (
                <Button
                  size="small"
                  danger={row.isActive}
                  onClick={() => run(() => updateMember({ id: row.id, isActive: !row.isActive }))}
                >
                  {row.isActive ? "Suspend" : "Restore"}
                </Button>
              ) : (
                <Tag color={row.isActive ? "green" : "default"}>
                  {row.isActive ? "active" : "suspended"}
                </Tag>
              ),
          },
        ]}
      />

      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        Suspending takes effect at the next sign-in: a session already open stays valid until it
        expires.
      </Typography.Paragraph>
    </Card>
  );
}
