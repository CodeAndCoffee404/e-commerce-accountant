"use client";

import {
  CarryOutOutlined,
  FileTextOutlined,
  InboxOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { Badge, Button, Layout, Menu, Space, theme, Tooltip, Typography } from "antd";
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
  CarryOutOutlined,
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
  // Read from the theme rather than written as a hex value: a separator that
  // ignores dark mode is the reason chrome ends up unreadable in one of them.
  const { token } = theme.useToken();
  const collapsed = useUiStore((store) => store.sidebarCollapsed);
  const setCollapsed = useUiStore((store) => store.setSidebarCollapsed);
  const themeMode = useUiStore((store) => store.themeMode);
  const toggleTheme = useUiStore((store) => store.toggleTheme);

  const activeItem = NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  // A disabled page is still reachable by typing its address, and highlighting
  // a row nobody can click would only puzzle whoever got there.
  const selectedKeys = activeItem && !activeItem.disabled ? [activeItem.key] : [];

  const menuItems = NAV_ITEMS.map((item) => {
    const Icon = ICONS[item.icon];

    // The count sits on Uploads, which is where a flagged row can now be seen
    // and acted on — one expander below the file that produced it. Without it
    // a flagged row waits until somebody happens to look.
    const badge =
      item.key === "uploads" && needsAttention > 0 ? (
        <Badge count={needsAttention} size="small" offset={[6, -2]} />
      ) : null;

    return {
      key: item.key,
      icon: <Icon />,
      disabled: item.disabled,
      // A disabled row gets no link at all: greying out something that still
      // navigates is the worst of both.
      label: item.disabled ? (
        <Tooltip title={item.disabledReason} placement="right">
          <span>{item.label}</span>
        </Tooltip>
      ) : (
        <Link href={item.href}>
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
        style={{ borderInlineEnd: `1px solid ${token.colorSplit}` }}
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
            borderBottom: `1px solid ${token.colorSplit}`,
          }}
        >
          <Typography.Text strong style={{ fontSize: 15 }}>
            {collapsed ? "EA" : "E-commerce Accountant"}
          </Typography.Text>
        </Link>

        <Menu
          mode="inline"
          theme={themeMode}
          selectedKeys={selectedKeys}
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
            borderBottom: `1px solid ${token.colorSplit}`,
            // Stays put while a long table scrolls, so the way out is always
            // in reach.
            position: "sticky",
            top: 0,
            zIndex: 10,
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
