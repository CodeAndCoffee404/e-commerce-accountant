export type NavItem = {
  key: string;
  href: string;
  label: string;
  /** Name of the icon exported from @ant-design/icons. */
  icon:
    | "HomeOutlined"
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
    // The welcome screen and the landing page: where the month stands and
    // whether anything needs you. Everything below it is detail.
    key: "dashboard",
    href: "/dashboard",
    label: "Dashboard",
    icon: "HomeOutlined",
  },
  {
    // The key stays `uploads`: it is what the badge and the selected row are
    // matched on, and nothing outside this file reads it as a name.
    key: "uploads",
    href: "/source-files",
    label: "Source files",
    icon: "InboxOutlined",
  },
  {
    key: "transactions",
    href: "/transactions",
    label: "Transactions",
    icon: "SwapOutlined",
    disabled: true,
    disabledReason:
      "Not in use yet. Row-level figures are on each source file, under the expander.",
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

export const DEFAULT_ROUTE = "/dashboard";
