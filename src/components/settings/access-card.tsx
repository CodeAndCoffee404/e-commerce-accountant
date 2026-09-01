"use client";

import { App, Button, Card, Popconfirm, Select, Space, Table, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { resetRoleAccess, saveRoleAccess } from "@/lib/access/actions";
import {
  ACCESS_LABELS,
  levelsFor,
  SECTIONS,
  type AccessLevel,
  type SectionDefinition,
} from "@/lib/access/sections";
import type { RoleAccessMatrix } from "@/lib/access/queries";

/** The roles whose access is settable. The owner's is not — see below. */
const EDITABLE_ROLES = [
  { role: "accountant" as const, label: "Accountant" },
  { role: "viewer" as const, label: "Viewer" },
];

export function AccessCard({
  matrix,
  isOwner,
}: {
  matrix: RoleAccessMatrix;
  /** Everyone else reads this table; only the owner changes it. */
  isOwner: boolean;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; message: string }>) =>
    startTransition(async () => {
      try {
        const result = await action();

        if (result.ok) message.success(result.message, 4);
        else message.error(result.message, 8);
      } catch {
        message.error(
          "The server could not be reached — nothing was changed. Check the connection and try again.",
          8,
        );
      }

      router.refresh();
    });

  return (
    <Card size="small" variant="borderless">
      <Typography.Paragraph type="secondary">
        A person is given a role on the Team tab; this table decides what that role may do. Change
        a row here and it applies to everyone holding that role, immediately.
      </Typography.Paragraph>

      {isOwner ? null : (
        <Typography.Paragraph type="secondary">
          Only an owner can change access. This is what has been set for your role and the others.
        </Typography.Paragraph>
      )}

      <Table<SectionDefinition>
        size="small"
        rowKey="id"
        pagination={false}
        scroll={{ x: 720 }}
        dataSource={[...SECTIONS]}
        columns={[
          {
            title: "Section",
            dataIndex: "label",
            width: 260,
            render: (label: string, section) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{label}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {section.description}
                </Typography.Text>
              </Space>
            ),
          },
          {
            // Shown, not offered: an owner who could sign their own access away
            // would have no way back into this screen to undo it.
            title: "Owner",
            key: "owner",
            width: 140,
            render: () => <Tag>Full access</Tag>,
          },
          ...EDITABLE_ROLES.map(({ role, label }) => ({
            title: label,
            key: role,
            width: 180,
            render: (_: unknown, section: SectionDefinition) =>
              section.ownerOnly ? (
                <Tag>Owner only</Tag>
              ) : (
                <Select<AccessLevel>
                  size="small"
                  style={{ width: 150 }}
                  disabled={!isOwner || pending}
                  value={matrix[role][section.id]}
                  onChange={(access) =>
                    run(() => saveRoleAccess({ role, section: section.id, access }))
                  }
                  options={levelsFor(section).map((level) => ({
                    value: level,
                    label: ACCESS_LABELS[level],
                  }))}
                />
              ),
          })),
          {
            title: "Full access means",
            key: "edit",
            render: (_: unknown, section: SectionDefinition) => (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {section.editMeans ?? "Nothing to change here — this section is read-only."}
              </Typography.Text>
            ),
          },
        ]}
      />

      {isOwner ? (
        <Space style={{ marginTop: 16 }} wrap>
          {EDITABLE_ROLES.map(({ role, label }) => (
            <Popconfirm
              key={role}
              title={`Put ${label} back on the defaults?`}
              description="Every section this role was given or denied by hand goes back to how the app ships."
              okText="Reset"
              onConfirm={() => run(() => resetRoleAccess(role))}
            >
              <Button size="small" disabled={pending}>
                Reset {label}
              </Button>
            </Popconfirm>
          ))}
        </Space>
      ) : null}
    </Card>
  );
}
