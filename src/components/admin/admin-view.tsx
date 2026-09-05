"use client";

import {
  BankOutlined,
  DeleteOutlined,
  LockOutlined,
  LoginOutlined,
  PlusOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createCompany,
  deleteCompany,
  enterCompany,
  setCompanyBlocked,
} from "@/lib/admin/actions";
import type { CompanyPerson, CompanySummary } from "@/lib/admin/queries";
import { DEFAULT_ROUTE } from "@/lib/navigation";

/**
 * The list of companies and what can be done to them.
 *
 * Plain on purpose. It is a hallway, not a room: what matters is that the
 * names are unambiguous, that stepping into one is a deliberate act, and that
 * the one irreversible button is not something a slipped click can reach.
 */
export function AdminView({
  companies,
  current,
}: {
  companies: CompanySummary[];
  /** The company this session is in, so the row you are already inside says so. */
  current: string;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const [pending, start] = useTransition();
  const [form] = Form.useForm();
  const [removing, setRemoving] = useState<CompanySummary | null>(null);
  const [typedName, setTypedName] = useState("");

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
          expandable={{
            // Who may come in, under the company they belong to. Read-only:
            // taking someone's access away is their own owner's decision, on
            // their own Team screen, where they can see what else it affects.
            expandedRowRender: (row) => <People people={row.people} />,
            rowExpandable: () => true,
          }}
          columns={[
            {
              title: "Company",
              dataIndex: "name",
              render: (name: string, row) => (
                <Space>
                  <BankOutlined />
                  <span>{name}</span>
                  {row.id === current ? <Tag color="blue">You are here</Tag> : null}
                  {row.blockedAt ? (
                    <Tooltip
                      title={`Closed on ${new Date(row.blockedAt).toLocaleDateString()}. It can be read; nothing can be changed.`}
                    >
                      <Tag color="warning">Closed</Tag>
                    </Tooltip>
                  ) : null}
                </Space>
              ),
            },
            {
              title: "People",
              dataIndex: "people",
              align: "right",
              render: (people: CompanyPerson[]) => people.length,
            },
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
              key: "actions",
              align: "right",
              render: (_: unknown, row) => (
                <Space>
                  {row.id === current ? null : (
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
                  )}

                  <Button
                    size="small"
                    icon={row.blockedAt ? <UnlockOutlined /> : <LockOutlined />}
                    disabled={pending}
                    onClick={() => run(() => setCompanyBlocked(row.id, !row.blockedAt))}
                  >
                    {row.blockedAt ? "Open" : "Close"}
                  </Button>

                  <Tooltip
                    title={
                      row.blockedAt
                        ? "Removes the company, its rows and its files. This cannot be undone."
                        : "Close the company first. Deleting one that is in use should take two decisions."
                    }
                  >
                    {/* A span, because a disabled antd button swallows the hover
                        and the tooltip is where the reason lives. */}
                    <span>
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={pending || !row.blockedAt}
                        onClick={() => {
                          setRemoving(row);
                          setTypedName("");
                        }}
                        aria-label={`Delete ${row.name}`}
                      />
                    </span>
                  </Tooltip>
                </Space>
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

      <Modal
        title={removing ? `Delete ${removing.name}?` : "Delete"}
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        okText="Delete for good"
        okButtonProps={{ danger: true, disabled: typedName.trim() !== removing?.name || pending }}
        confirmLoading={pending}
        onOk={() =>
          removing &&
          run(
            () => deleteCompany(removing.id, typedName),
            () => setRemoving(null),
          )
        }
        destroyOnHidden
      >
        <Typography.Paragraph>
          Its rows, its uploaded files and its built reports are removed and cannot be brought
          back. The people on its list keep their accounts and any other company they are in.
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          Type <Typography.Text code>{removing?.name}</Typography.Text> to confirm.
        </Typography.Paragraph>
        <Input
          value={typedName}
          onChange={(event) => setTypedName(event.target.value)}
          placeholder={removing?.name}
          autoFocus
        />
      </Modal>
    </Space>
  );
}

/** The access list of one company: who may come in, and as what. */
function People({ people }: { people: CompanyPerson[] }) {
  if (people.length === 0) {
    return <Typography.Text type="secondary">Nobody has been invited yet.</Typography.Text>;
  }

  return (
    <Table<CompanyPerson>
      rowKey="email"
      dataSource={people}
      pagination={false}
      size="small"
      showHeader={false}
      columns={[
        { title: "Address", dataIndex: "email" },
        {
          title: "Role",
          dataIndex: "role",
          width: 140,
          render: (role: string) => <Tag>{role}</Tag>,
        },
        {
          title: "Active",
          dataIndex: "isActive",
          width: 140,
          render: (isActive: boolean) =>
            isActive ? (
              <Typography.Text type="secondary">can sign in</Typography.Text>
            ) : (
              <Tag color="warning">suspended</Tag>
            ),
        },
      ]}
    />
  );
}
