"use client";

import {
  FileTextOutlined,
  HomeOutlined,
  InboxOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { Badge, Button, Layout, Menu, Space, Spin, theme, Tooltip, Typography } from "antd";
import Image from "next/image";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";

import { HelpModal } from "@/components/layout/help-modal";
import { UserMenu } from "@/components/layout/user-menu";
import type { CurrentUser } from "@/lib/auth/session";
import { DEFAULT_ROUTE, NAV_ITEMS, type NavItem } from "@/lib/navigation";
import { useUiStore } from "@/stores/ui-store-provider";

const { Header, Sider, Content } = Layout;

/**
 * Inline feedback on the menu item that was just clicked. Every page here is
 * server-rendered, so without this a click on a slow network looks like
 * nothing happened — the surest way to get clicked twice.
 */
function PendingHint() {
  const { pending } = useLinkStatus();

  if (!pending) return null;

  return <Spin size="small" style={{ marginInlineStart: 8 }} />;
}

const ICONS: Record<NavItem["icon"], ComponentType> = {
  HomeOutlined,
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
          <PendingHint />
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
          href={DEFAULT_ROUTE}
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: collapsed ? "center" : "flex-start",
            padding: collapsed ? 0 : "0 12px",
            overflow: "hidden",
            whiteSpace: "nowrap",
            borderBottom: `1px solid ${token.colorSplit}`,
          }}
        >
          {collapsed ? (
            <Image
              src="/logo-mark.png"
              alt="Halum"
              width={26}
              height={26}
              style={{
                flex: "0 0 26px",
                objectFit: "contain",
                // The mark is drawn black-on-transparent; inverted to white
                // on the dark sidebar rather than shipping a second file.
                filter: themeMode === "dark" ? "invert(1)" : undefined,
              }}
            />
          ) : (
            <Image
              src="/logo-wordmark.png"
              alt="Halum"
              width={72}
              height={24}
              style={{
                objectFit: "contain",
                filter: themeMode === "dark" ? "invert(1)" : undefined,
              }}
            />
          )}
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
            // in reach — and lets the content glow through a blur instead of
            // being sliced by a solid bar.
            position: "sticky",
            top: 0,
            zIndex: 10,
            background: `color-mix(in srgb, ${token.colorBgContainer} 78%, transparent)`,
            backdropFilter: "saturate(160%) blur(10px)",
            WebkitBackdropFilter: "saturate(160%) blur(10px)",
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
