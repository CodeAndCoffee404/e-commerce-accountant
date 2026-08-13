export type NavItem = {
  key: string;
  href: string;
  label: string;
  /** Name of the icon exported from @ant-design/icons. */
  icon: "InboxOutlined" | "SwapOutlined" | "FileTextOutlined" | "SettingOutlined";
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    key: "uploads",
    href: "/uploads",
    label: "Uploads",
    icon: "InboxOutlined",
  },
  {
    key: "transactions",
    href: "/transactions",
    label: "Transactions",
    icon: "SwapOutlined",
  },
  {
    key: "reports",
    href: "/reports",
    label: "Reports",
    icon: "FileTextOutlined",
  },
  {
    key: "settings",
    href: "/settings",
    label: "Settings",
    icon: "SettingOutlined",
  },
] as const;

export const DEFAULT_ROUTE = "/uploads";
