"use client";

import { Card, Skeleton, Space, theme } from "antd";

/**
 * What a page shows while its data is being fetched.
 *
 * Every screen here reads the database on the server, so without this the
 * browser sits on the previous page with nothing to say.
 *
 * The pieces below exist so each page's own skeleton can be the shape of that
 * page rather than a generic pair of blocks. That is not decoration: a
 * skeleton the wrong shape moves everything when the data lands, and the eye
 * has to find its place twice. The dashboard was built this way first and the
 * difference was obvious enough to be worth repeating everywhere.
 */

/** The title and the sentence under it, on the pages that have one. */
export function SkeletonHeader() {
  return <Skeleton active title={{ width: 220 }} paragraph={{ rows: 1, width: ["60%"] }} />;
}

/** A row of filter controls: fixed heights, so nothing shifts when they arrive. */
export function SkeletonFilters({ count = 4 }: { count?: number }) {
  return (
    <Space size={8} wrap>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton.Input key={index} active size="default" style={{ width: index === 0 ? 220 : 160 }} />
      ))}
    </Space>
  );
}

/**
 * A table: a heading strip and its rows.
 *
 * Rows are drawn as full-width blocks rather than cells — at this size the eye
 * reads the rhythm, not the columns, and a grid of little bars looks busier
 * than the table it stands in for.
 */
export function SkeletonTable({ rows = 8 }: { rows?: number }) {
  const { token } = theme.useToken();

  return (
    <div
      style={{
        border: `1px solid ${token.colorSplit}`,
        borderRadius: token.borderRadiusLG,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "12px 16px", background: token.colorFillQuaternary }}>
        <Skeleton active title={{ width: "30%" }} paragraph={false} />
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            style={{
              padding: "14px 16px",
              borderTop: index === 0 ? undefined : `1px solid ${token.colorSplit}`,
            }}
          >
            <Skeleton
              active
              title={false}
              paragraph={{ rows: 1, width: `${92 - (index % 4) * 7}%` }}
              style={{ marginBottom: 0 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Cards side by side, the way the report and settings screens lay out. */
export function SkeletonCards({ count = 3, rows = 3 }: { count?: number; rows?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
        gap: 16,
      }}
    >
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} size="small">
          <Skeleton active title={{ width: 140 }} paragraph={{ rows }} />
        </Card>
      ))}
    </div>
  );
}

/**
 * The generic one, for a page with no shape of its own to imitate — and for
 * the root, which stands in for the shell itself before any page is known.
 */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <SkeletonHeader />
      <Skeleton active title={false} paragraph={{ rows, width: "100%" }} />
    </Space>
  );
}
