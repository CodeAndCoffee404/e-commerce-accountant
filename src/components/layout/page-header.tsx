"use client";

import { Typography } from "antd";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  extra,
}: {
  title: string;
  description?: string;
  extra?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 24,
      }}
    >
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {description ? (
          <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
            {description}
          </Typography.Paragraph>
        ) : null}
      </div>
      {extra}
    </div>
  );
}