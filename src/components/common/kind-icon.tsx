"use client";

import { FileTextOutlined, InboxOutlined } from "@ant-design/icons";

import { useKindAccent, type EntityKind } from "./kind-accent";

/**
 * The one visual vocabulary for "this is a report" vs "this is a source file",
 * used wherever either entity appears as a row: a small rounded chip, blue
 * document for reports, purple inbox tray for source files. Colours come from
 * `useKindAccent`, so changing either one changes it everywhere at once.
 */
export function KindIcon({ kind, size = 26 }: { kind: EntityKind; size?: number }) {
  const { accent, tint } = useKindAccent(kind);

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
        background: tint,
        color: accent,
      }}
    >
      {kind === "report" ? <FileTextOutlined /> : <InboxOutlined />}
    </span>
  );
}
