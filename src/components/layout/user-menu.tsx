"use client";

import {
  BankOutlined,
  CheckOutlined,
  DeploymentUnitOutlined,
  LogoutOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Avatar, Dropdown, Typography, message } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import type { Company } from "@/lib/auth/allowlist";
import { signOutAction } from "@/lib/auth/actions";
import { switchCompany } from "@/lib/auth/companies";
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
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {user.email} · {user.role}
                </Typography.Text>
                <Typography.Text style={{ fontSize: 12 }}>{company}</Typography.Text>
              </div>
            ),
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
  );
}
