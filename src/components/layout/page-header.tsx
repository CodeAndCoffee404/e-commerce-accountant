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
    // The same arrival as the dashboard's own blocks: a page settles into
    // place from the top down rather than appearing all at once, and the
    // header is the top of it.
    <div
      className="ea-rise"
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        // Wraps on a phone rather than crushing the description into a column
        // two words wide.
        flexWrap: "wrap",
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