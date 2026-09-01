import type { SectionId } from "@/lib/access/sections";

export type NavItem = {
  key: string;
  href: string;
  label: string;
  /**
   * Sections that put this item in the menu. The row shows when the person's
   * role may view any of them — Settings is one screen over several sections.
   */
  sections: readonly SectionId[];
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
    sections: ["dashboard"],
    href: "/dashboard",
    label: "Dashboard",
    icon: "HomeOutlined",
  },
  {
    // The key stays `uploads`: it is what the badge and the selected row are
    // matched on, and nothing outside this file reads it as a name.
    key: "uploads",
    sections: ["source_files"],
    href: "/source-files",
    label: "Source files",
    icon: "InboxOutlined",
  },
  {
    key: "transactions",
    sections: ["transactions"],
    href: "/transactions",
    label: "Transactions",
    icon: "SwapOutlined",
    disabled: true,
    disabledReason:
      "Not in use yet. Row-level figures are on each source file, under the expander.",
  },
  {
    key: "reports",
    sections: ["reports"],
    href: "/reports",
    label: "Reports",
    icon: "FileTextOutlined",
  },
  {
    key: "settings",
    sections: ["settings_company", "settings_deadlines", "team", "activity"],
    href: "/settings",
    label: "Settings",
    icon: "SettingOutlined",
  },
] as const;

export const DEFAULT_ROUTE = "/dashboard";

/** The menu as this person's role sees it. */
export function visibleNavItems(
  access: Record<SectionId, "none" | "view" | "edit">,
): NavItem[] {
  return NAV_ITEMS.filter((item) =>
    item.sections.some((section) => access[section] !== "none"),
  );
}

/**
 * Where to land someone. The dashboard when they may see it, otherwise the
 * first section they can — a person whose role is scoped to Reports should
 * open on Reports, not on a wall.
 */
export function landingRoute(
  access: Record<SectionId, "none" | "view" | "edit">,
): string {
  const visible = visibleNavItems(access).filter((item) => !item.disabled);
  const preferred = visible.find((item) => item.href === DEFAULT_ROUTE);

  return preferred?.href ?? visible[0]?.href ?? "/no-access";
}
