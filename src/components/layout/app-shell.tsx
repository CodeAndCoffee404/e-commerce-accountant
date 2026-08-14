"use client";

import {
  FileTextOutlined,
  InboxOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { Badge, Button, Layout, Menu, Space, Tooltip, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";

import { HelpModal } from "@/components/layout/help-modal";
import { UserMenu } from "@/components/layout/user-menu";
import type { CurrentUser } from "@/lib/auth/session";
import { NAV_ITEMS, type NavItem } from "@/lib/navigation";
import { useUiStore } from "@/stores/ui-store-provider";

const { Header, Sider, Content } = Layout;

const ICONS: Record<NavItem["icon"], ComponentType> = {
  InboxOutlined,
  SwapOutlined,
  FileTextOutlined,
  SettingOutlined,
};

export function AppShell({
  children,
  user,
  needsAttention,
}: {
  children: ReactNode;
  user: CurrentUser;
  /** Rows a person has to look at. Zero hides the badge entirely. */
  needsAttention: number;
}) {
  const pathname = usePathname();
  const collapsed = useUiStore((store) => store.sidebarCollapsed);
  const setCollapsed = useUiStore((store) => store.setSidebarCollapsed);
  const themeMode = useUiStore((store) => store.themeMode);
  const toggleTheme = useUiStore((store) => store.toggleTheme);

  const activeItem = NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  const menuItems = NAV_ITEMS.map((item) => {
    const Icon = ICONS[item.icon];

    // The count sits on Transactions, where the filter that shows them lives.
    // Without it a flagged row waits until somebody happens to look.
    const badge =
      item.key === "transactions" && needsAttention > 0 ? (
        <Badge count={needsAttention} size="small" offset={[6, -2]} />
      ) : null;

    return {
      key: item.key,
      icon: <Icon />,
      label: (
        <Link href={item.key === "transactions" && needsAttention > 0 ? `${item.href}?attention=1` : item.href}>
          {item.label}
          {badge}
        </Link>
      ),
    };
  });

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        theme={themeMode}
        width={220}
        // Collapses itself on a narrow screen: at 220px the sidebar would take
        // half a phone, and this app is used on one when a file arrives by mail.
        breakpoint="lg"
        collapsedWidth={64}
      >
        <Link
          href={NAV_ITEMS[0].href}
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            padding: collapsed ? 0 : "0 20px",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <Typography.Text strong style={{ fontSize: 15 }}>
            {collapsed ? "EA" : "E-commerce Accountant"}
          </Typography.Text>
        </Link>

        <Menu
          mode="inline"
          theme={themeMode}
          selectedKeys={activeItem ? [activeItem.key] : []}
          items={menuItems}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingInline: 16,
          }}
        >
          <Space size={12}>
            <Button
              type="text"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />

            {/* Where you are, for when the sidebar is collapsed to icons. */}
            <Typography.Text strong>{activeItem?.label ?? ""}</Typography.Text>
          </Space>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <HelpModal />

            <Tooltip title={themeMode === "dark" ? "Switch to light" : "Switch to dark"}>
              <Button
                type="text"
                aria-label="Toggle colour theme"
                icon={themeMode === "dark" ? <SunOutlined /> : <MoonOutlined />}
                onClick={toggleTheme}
              />
            </Tooltip>

            <UserMenu user={user} />
          </div>
        </Header>

        {/* A max width so a wide table stays readable, and breathing room on a
            phone where 24px of padding costs a column. */}
        <Content style={{ padding: "clamp(12px, 3vw, 24px)" }}>
          <div style={{ maxWidth: 1600, margin: "0 auto" }}>{children}</div>
        </Content>
      </Layout>
    </Layout>
  );
}
