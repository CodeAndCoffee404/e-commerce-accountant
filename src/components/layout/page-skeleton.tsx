"use client";

import { Skeleton, Space } from "antd";

/**
 * What a page shows while its data is being fetched.
 *
 * Every screen here reads the database on the server, so without this the
 * browser sits on the previous page with nothing to say. A shape roughly like
 * the real one keeps the layout from jumping when the content lands.
 */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Skeleton active title={{ width: 220 }} paragraph={{ rows: 1, width: ["60%"] }} />
      <Skeleton active title={false} paragraph={{ rows, width: "100%" }} />
    </Space>
  );
}
