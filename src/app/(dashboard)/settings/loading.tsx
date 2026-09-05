"use client";

import { Skeleton, Space } from "antd";

import { SkeletonCards } from "@/components/layout/page-skeleton";

/** Settings opens on a strip of tabs with one panel under it. */
export default function Loading() {
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space size={16} wrap>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton.Button key={index} active size="small" style={{ width: 92 }} />
        ))}
      </Space>
      <SkeletonCards count={1} rows={6} />
    </Space>
  );
}
