"use client";

import { FileTextOutlined, InboxOutlined } from "@ant-design/icons";
import { theme } from "antd";

/**
 * The one visual vocabulary for "this is a report" vs "this is an upload",
 * used wherever either entity appears as a row: a small rounded chip, blue
 * document for reports, amber inbox tray for uploads. Colours come from the
 * theme tokens so both chips keep their contrast in dark mode.
 */
export function KindIcon({ kind, size = 26 }: { kind: "report" | "upload"; size?: number }) {
  const { token } = theme.useToken();

  const palette =
    kind === "report"
      ? { background: token.colorPrimaryBg, color: token.colorPrimary }
      : { background: token.colorWarningBg, color: token.colorWarning };

  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        fontSize: Math.round(size * 0.55),
        background: palette.background,
        color: palette.color,
      }}
    >
      {kind === "report" ? <FileTextOutlined /> : <InboxOutlined />}
    </span>
  );
}
