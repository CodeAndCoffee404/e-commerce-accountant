import { Skeleton, Space } from "antd";

/**
 * What the browser gets while the shell itself is still being built.
 *
 * Every other `loading.tsx` in this application sits inside the dashboard
 * layout, and so appears only once that layout has rendered — which means
 * after the session has been checked and the company read. On a hard load
 * (signing in, a refresh, switching company) that left a blank page for the
 * whole round trip: the skeletons were behind the very thing being waited for.
 *
 * This one is above the layout, so it is the first thing painted. Deliberately
 * not a copy of the sidebar: guessing at a shell that is a few hundred
 * milliseconds away reads as a flicker when the real one lands.
 */
export default function Loading() {
  return (
    <Space direction="vertical" size="large" style={{ width: "100%", padding: 24 }}>
      <Skeleton active title={{ width: 180 }} paragraph={{ rows: 1, width: ["40%"] }} />
      <Skeleton active title={false} paragraph={{ rows: 6, width: "100%" }} />
    </Space>
  );
}
