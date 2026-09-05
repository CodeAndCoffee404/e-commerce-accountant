"use client";

import {
  BankOutlined,
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
import { Alert, Badge, Button, Layout, Menu, Space, Spin, Tag, theme, Tooltip, Typography } from "antd";
import Image from "next/image";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";

import { HelpModal } from "@/components/layout/help-modal";
import { UserMenu } from "@/components/layout/user-menu";
import type { AccessMap } from "@/lib/access/sections";
import type { Company } from "@/lib/auth/allowlist";
import type { CurrentUser } from "@/lib/auth/session";
import {
  NAV_ITEMS,
  landingRoute,
  visibleNavItems,
  type NavItem,
} from "@/lib/navigation";
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
  access,
  needsAttention,
  company,
  companyBlocked,
  companies,
}: {
  children: ReactNode;
  user: CurrentUser;
  /** What this person's role may see. Sections closed to it are not in the menu. */
  access: AccessMap;
  /** Rows a person has to look at. Zero hides the badge entirely. */
  needsAttention: number;
  /** The company being worked in, named in the bar so it is never a guess. */
  company: string;
  /** Closed: readable, and nothing in it changeable. Said once, at the top. */
  companyBlocked: boolean;
  /** Everything this person could switch to. One means no switcher. */
  companies: Company[];
}) {
  const pathname = usePathname();
  // Read from the theme rather than written as a hex value: a separator that
  // ignores dark mode is the reason chrome ends up unreadable in one of them.
  const { token } = theme.useToken();
  const collapsed = useUiStore((store) => store.sidebarCollapsed);
  const setCollapsed = useUiStore((store) => store.setSidebarCollapsed);
  const themeMode = useUiStore((store) => store.themeMode);
  const toggleTheme = useUiStore((store) => store.toggleTheme);

  // The whole list is still searched for the header title — a page reached by
  // its address should name itself even while its row is not in the menu.
  const activeItem = NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const items = visibleNavItems(access);
  const home = landingRoute(access);

  // A disabled page is still reachable by typing its address, and highlighting
  // a row nobody can click would only puzzle whoever got there.
  const selectedKeys = activeItem && !activeItem.disabled ? [activeItem.key] : [];

  const menuItems = items.map((item) => {
    const Icon = ICONS[item.icon];

    // The count sits on Source files, which is where a flagged row can now be
    // seen and acted on — one expander below the file that produced it. Without
    // it a flagged row waits until somebody happens to look.
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
          href={home}
          aria-label="Halum — go to the dashboard"
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            // Clips the wordmark's own width down to whatever the Sider
            // currently is (64 or 220 — this element sets none of its own,
            // so it just inherits the block width, which is already what
            // animates) rather than swapping which logo renders. Collapsed
            // only ever shows the mark, not a clipped fragment of the
            // wordmark's text — see the opacity crossfade below.
            overflow: "hidden",
            whiteSpace: "nowrap",
            borderBottom: `1px solid ${token.colorSplit}`,
          }}
        >
          {/* Both logos stay mounted the whole time and cross-fade via
              opacity; the collapsed/expanded case used to swap which
              <Image> was rendered, which is an instant unmount/remount with
              no transition of its own — one more thing popping independently
              of the ~200ms the Sider itself takes to resize. */}
          <span style={{ position: "relative", width: 99, height: 33, flex: "0 0 auto" }}>
            <Image
              src="/logo-mark.png"
              alt=""
              width={26}
              height={26}
              style={{
                position: "absolute",
                // Left insets differ (15 vs 11) because the icon glyph sits
                // at a different offset inside each source image — measured
                // from both PNGs' pixel content so the glyph itself lands on
                // the same screen position in both, and the cross-fade reads
                // as one icon, not two swapping in and out of alignment.
                left: 15,
                top: "50%",
                transform: "translateY(-50%)",
                objectFit: "contain",
                opacity: collapsed ? 1 : 0,
                transition: "opacity 0.2s ease-in-out",
                filter: themeMode === "dark" ? "invert(1)" : undefined,
              }}
            />
            <Image
              src="/logo-wordmark.png"
              alt=""
              width={99}
              height={33}
              style={{
                position: "absolute",
                left: 11,
                top: "50%",
                transform: "translateY(-50%)",
                objectFit: "contain",
                opacity: collapsed ? 0 : 1,
                transition: "opacity 0.2s ease-in-out",
                // The icon glyph inside logo-wordmark.png sits on a taller
                // canvas than the standalone mark, with more padding around
                // it — measured both PNGs' pixel content (icon fills 76/128
                // of the mark's canvas height, 45/96 of the wordmark's) and
                // sized this so the glyph itself renders the same height
                // either way.
                filter: themeMode === "dark" ? "invert(1)" : undefined,
              }}
            />
          </span>
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

            {/* Whose books these are. Always shown, not only when there are
                several: the cost of an upload landing in the wrong company is
                paid by whoever reconciles it a month later, and a name in the
                bar is the cheapest thing standing between them and that. */}
            <Tag icon={<BankOutlined />} style={{ marginInlineStart: 4 }}>
              {company}
            </Tag>
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

            <UserMenu user={user} company={company} companies={companies} />
          </div>
        </Header>

        {/* A max width so a wide table stays readable, and breathing room on a
            phone where 24px of padding costs a column. */}
        <Content style={{ padding: "clamp(12px, 3vw, 24px)" }}>
          <div style={{ maxWidth: 1600, margin: "0 auto" }}>
            {/* Above the page, not beside a button: every screen in a closed
                company behaves this way, and finding out by having a save
                refused is the version of this worth avoiding. */}
            {companyBlocked ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message="This company is closed"
                description="Everything here can be read. Nothing can be uploaded, built or changed until it is opened again."
              />
            ) : null}
            {children}
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
