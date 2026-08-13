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
import { Button, Layout, Menu, Tooltip, Typography } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";

import { NAV_ITEMS, type NavItem } from "@/lib/navigation";
import { useUiStore } from "@/stores/ui-store-provider";

const { Header, Sider, Content } = Layout;

const ICONS: Record<NavItem["icon"], ComponentType> = {
  InboxOutlined,
  SwapOutlined,
  FileTextOutlined,
  SettingOutlined,
};

export function AppShell({ children }: { children: ReactNode }) {
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

    return {
      key: item.key,
      icon: <Icon />,
      label: <Link href={item.href}>{item.label}</Link>,
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
      >
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            padding: collapsed ? "0 16px" : "0 20px",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <Typography.Text strong style={{ fontSize: 15 }}>
            {collapsed ? "EA" : "E-commerce Accountant"}
          </Typography.Text>
        </div>

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
          <Button
            type="text"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />

          <Tooltip title={themeMode === "dark" ? "Switch to light" : "Switch to dark"}>
            <Button
              type="text"
              aria-label="Toggle colour theme"
              icon={themeMode === "dark" ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggleTheme}
            />
          </Tooltip>
        </Header>

        <Content style={{ padding: 24 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
