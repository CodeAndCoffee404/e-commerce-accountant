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
            bodyBg: themeMode === "dark" ? "#141414" : "#f5f6f8",
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
