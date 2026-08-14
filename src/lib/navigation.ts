export type NavItem = {
  key: string;
  href: string;
  label: string;
  /** Name of the icon exported from @ant-design/icons. */
  icon:
    | "CarryOutOutlined"
    | "InboxOutlined"
    | "SwapOutlined"
    | "FileTextOutlined"
    | "SettingOutlined";
  /**
   * Present in the menu but not reachable. The page and its code stay as they
   * are — this only takes it out of the way until it earns its place back.
   */
  disabled?: true;
  /** Shown on hover when disabled, so the greyed-out row explains itself. */
  disabledReason?: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    // First and the landing page: the ritual the app exists for. Everything
    // else is its detail view.
    key: "close",
    href: "/close",
    label: "Month close",
    icon: "CarryOutOutlined",
  },
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
    disabled: true,
    disabledReason: "Not in use yet. Row-level figures are on each upload, under the expander.",
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

export const DEFAULT_ROUTE = "/close";
