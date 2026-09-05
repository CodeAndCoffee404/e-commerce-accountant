"use client";

import { Space } from "antd";

import { SkeletonCards } from "@/components/layout/page-skeleton";

/**
 * Reports, which is a card per report rather than a table — so the skeleton is
 * cards too, at the width they will actually take.
 */
export default function Loading() {
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <SkeletonCards count={4} rows={4} />
    </Space>
  );
}
