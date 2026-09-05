"use client";

import { Space } from "antd";

import { SkeletonFilters, SkeletonHeader, SkeletonTable } from "@/components/layout/page-skeleton";

/** The ledger: a title, the filters that narrow it, and the rows themselves. */
export default function Loading() {
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <SkeletonHeader />
      <SkeletonFilters count={5} />
      <SkeletonTable rows={10} />
    </Space>
  );
}
