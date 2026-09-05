"use client";

import { Space } from "antd";

import { SkeletonFilters, SkeletonTable } from "@/components/layout/page-skeleton";

/**
 * Source files, in outline: the filter row and the table under it.
 *
 * No header block — the page has none, because the app bar already names it.
 */
export default function Loading() {
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <SkeletonFilters count={4} />
      <SkeletonTable rows={8} />
    </Space>
  );
}
