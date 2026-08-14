"use client";

import { Card, Skeleton, Space, theme } from "antd";

/**
 * The dashboard's own skeleton, hero-shaped so nothing jumps when the data
 * lands. This page is the landing page and reads the most, so it is exactly
 * the navigation that most needs an immediate answer on click.
 */
export default function Loading() {
  const { token } = theme.useToken();

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Skeleton active title={{ width: 180 }} paragraph={{ rows: 1, width: ["50%"] }} />

      <div
        style={{
          borderRadius: 16,
          border: `1px solid ${token.colorSplit}`,
          padding: "clamp(18px, 3vw, 28px)",
          display: "flex",
          flexWrap: "wrap",
          gap: 24,
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ flex: "1 1 320px" }}>
          <Skeleton active title={{ width: 260 }} paragraph={{ rows: 2, width: ["70%", "40%"] }} />
        </div>
        <Space size={24}>
          <Skeleton.Avatar active size={118} shape="circle" />
          <Skeleton.Avatar active size={118} shape="circle" />
        </Space>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
          gap: 16,
        }}
      >
        <Card size="small">
          <Skeleton active title={{ width: 120 }} paragraph={{ rows: 3 }} />
        </Card>
        <Card size="small">
          <Skeleton active title={{ width: 120 }} paragraph={{ rows: 3 }} />
        </Card>
      </div>

      <Card size="small">
        <Skeleton active title={{ width: 100 }} paragraph={{ rows: 5, width: "100%" }} />
      </Card>
    </Space>
  );
}
