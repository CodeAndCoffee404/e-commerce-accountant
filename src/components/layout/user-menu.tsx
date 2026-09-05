"use client";

import {
  BankOutlined,
  CheckOutlined,
  DeploymentUnitOutlined,
  LogoutOutlined,
  EditOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Avatar, Dropdown, Input, Modal, Typography, message } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { Company } from "@/lib/auth/allowlist";
import { signOutAction } from "@/lib/auth/actions";
import { switchCompany } from "@/lib/auth/companies";
import { saveUserName } from "@/lib/members/actions";
import type { CurrentUser } from "@/lib/auth/session";

export function UserMenu({
  user,
  company,
  companies,
}: {
  user: CurrentUser;
  company: string;
  companies: Company[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Its own name here rather than a shared "renaming" flag: the Team screen is
  // where an owner renames other people, and this is only ever yourself.
  const [naming, setNaming] = useState<string | null>(null);

  function saveName() {
    if (naming === null) return;

    start(async () => {
      const result = await saveUserName({ name: naming });

      if (result.ok) message.success(result.message);
      else message.error(result.message, 8);

      setNaming(null);
      router.refresh();
    });
  }

  function move(tenantId: string) {
    if (tenantId === user.tenantId || pending) return;

    start(async () => {
      const result = await switchCompany(tenantId);

      if (!result.ok) {
        message.error(result.message);

        return;
      }

      router.refresh();
    });
  }

  // Only when there is something to switch to. One company is not a choice,
  // and a menu that offers it reads as though something were missing.
  const switcher =
    companies.length > 1
      ? [
          {
            key: "companies",
            type: "group" as const,
            label: "Company",
            children: companies.map((option) => ({
              key: `company-${option.id}`,
              icon: option.id === user.tenantId ? <CheckOutlined /> : <BankOutlined />,
              label: option.name,
              onClick: () => move(option.id),
            })),
          },
          { type: "divider" as const },
        ]
      : [];

  return (
    <>
    <Dropdown
      trigger={["click"]}
      menu={{
        items: [
          {
            key: "identity",
            disabled: true,
            label: (
              <div style={{ paddingBlock: 4 }}>
                <Typography.Text strong style={{ display: "block" }}>
                  {user.name ?? user.email}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                  {user.email} · {user.role}
                </Typography.Text>
                {/* Its own line: inline, it ran straight on from the role and
                    read as "ownerGeyser". */}
                <Typography.Text style={{ display: "block", fontSize: 12 }}>{company}</Typography.Text>
              </div>
            ),
          },
          {
            key: "name",
            icon: <EditOutlined />,
            // Here as well as on Team, because Team is the owner's screen: an
            // accountant or a viewer cannot open it, and their name is the one
            // shown beside everything they do.
            label: user.name ? "Change your name" : "Add your name",
            onClick: () => setNaming(user.name ?? ""),
          },
          { type: "divider" },
          ...switcher,
          // Only for the person above the companies, and only as a way back to
          // the list — everything else about a company is inside it.
          ...(user.isSuperAdmin
            ? [
                {
                  key: "admin",
                  icon: <DeploymentUnitOutlined />,
                  label: <Link href="/admin">All companies</Link>,
                },
                { type: "divider" as const },
              ]
            : []),
          {
            key: "sign-out",
            icon: <LogoutOutlined />,
            label: (
              // A form rather than an onClick fetch: signing out is a state
              // change, and a GET would let a third-party page trigger it.
              <form action={signOutAction}>
                <button
                  type="submit"
                  style={{
                    all: "unset",
                    display: "block",
                    width: "100%",
                    cursor: "pointer",
                  }}
                >
                  Sign out
                </button>
              </form>
            ),
          },
        ],
      }}
    >
      <Avatar
        src={user.image}
        icon={<UserOutlined />}
        style={{ cursor: "pointer" }}
        alt={user.email}
      />
    </Dropdown>

      <Modal
        title="Your name"
        open={naming !== null}
        onCancel={() => setNaming(null)}
        onOk={saveName}
        okText="Save"
        confirmLoading={pending}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          Shown beside everything you do, on the dashboard and in the activity log. Leave it empty
          and your address is shown instead.
        </Typography.Paragraph>
        <Input
          value={naming ?? ""}
          onChange={(event) => setNaming(event.target.value)}
          onPressEnter={saveName}
          placeholder={user.email}
          maxLength={120}
          autoFocus
        />
      </Modal>
    </>
  );
}
