"use client";

import { LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { Avatar, Dropdown, Typography } from "antd";

import { signOutAction } from "@/lib/auth/actions";
import type { CurrentUser } from "@/lib/auth/session";

export function UserMenu({ user }: { user: CurrentUser }) {
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
              </div>
            ),
          },
          { type: "divider" },
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
