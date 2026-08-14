"use client";

import { AntdRegistry } from "@ant-design/nextjs-registry";
import { App as AntdApp, ConfigProvider, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import type { ReactNode } from "react";

import type { ThemeMode } from "@/lib/theme";
import { UiStoreProvider, useUiStore } from "@/stores/ui-store-provider";

function AntdTheme({ children }: { children: ReactNode }) {
  const themeMode = useUiStore((store) => store.themeMode);

  return (
    <ConfigProvider
      locale={enUS}
      theme={{
        // Emits the palette as CSS variables, so plain CSS and inline styles can
        // reach a theme token instead of hard-coding a colour that then ignores
        // dark mode. Also lets one stylesheet serve both themes.
        cssVar: { prefix: "ant" },
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
