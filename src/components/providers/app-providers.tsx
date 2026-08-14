"use client";

import { AntdRegistry } from "@ant-design/nextjs-registry";
import { App as AntdApp, ConfigProvider, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import { useEffect, type ReactNode } from "react";

import type { ThemeMode } from "@/lib/theme";
import { UiStoreProvider, useUiStore } from "@/stores/ui-store-provider";

function AntdTheme({ children }: { children: ReactNode }) {
  const themeMode = useUiStore((store) => store.themeMode);

  // Native chrome — scrollbars, date pickers, autofill — follows the theme
  // too; without this dark mode keeps light scrollbars on Windows.
  useEffect(() => {
    document.documentElement.style.colorScheme = themeMode;
  }, [themeMode]);

  return (
    <ConfigProvider
      locale={enUS}
      theme={{
        // Emits the palette as CSS variables, so plain CSS and inline styles can
        // reach a theme token instead of hard-coding a colour that then ignores
        // dark mode. Also lets one stylesheet serve both themes.
        //
        // The key must change with the mode. With a constant key the
        // server-rendered light variables and the client's dark ones dedupe
        // into one stylesheet, and half the components keep the wrong palette —
        // dark layout, white selects. Seen in production on a phone.
        cssVar: { prefix: "ant", key: themeMode },
        hashed: false,
        algorithm:
          themeMode === "dark"
            ? antdTheme.darkAlgorithm
            : antdTheme.defaultAlgorithm,
        token: {
          fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
          colorPrimary: "#1668dc",
          borderRadius: 6,
        },
        components: {
          Menu: {
            // The dark menu defaults to antd's navy (#001529); the sider it
            // sits in is #141414. Same surface, same colour.
            darkItemBg: "#141414",
            darkSubMenuItemBg: "#141414",
            darkPopupBg: "#141414",
          },
          Layout: {
            // Two surfaces, deliberately: the page sits one step back and the
            // chrome sits on top of it.
            //
            // The header had no colour of its own, so it kept antd's default
            // navy in both themes — which put light-theme icons on a dark bar
            // and made them unreadable. In dark mode the body and the cards
            // were both #141414, so a table had no edge at all. Naming all
            // three fixes both.
            bodyBg: themeMode === "dark" ? "#000000" : "#f5f6f8",
            headerBg: themeMode === "dark" ? "#141414" : "#ffffff",
            siderBg: themeMode === "dark" ? "#141414" : "#ffffff",
            // Matches the brand block in the sidebar, so the two line up
            // across the gap instead of missing each other by eight pixels.
            headerHeight: 56,
          },
        },
      }}
    >
      {/* Gives hooks-based message/notification/modal a context to render into. */}
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}

export function AppProviders({
  children,
  initialThemeMode,
}: {
  children: ReactNode;
  initialThemeMode: ThemeMode;
}) {
  return (
    <UiStoreProvider initialState={{ themeMode: initialThemeMode }}>
      <AntdRegistry>
        <AntdTheme>{children}</AntdTheme>
      </AntdRegistry>
    </UiStoreProvider>
  );
}
