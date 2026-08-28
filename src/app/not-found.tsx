import Link from "next/link";

import { DEFAULT_ROUTE } from "@/lib/navigation";

export const metadata = { title: "Not found" };

/**
 * Plain HTML on purpose: this file also answers requests that never reached a
 * signed-in layout, so it cannot rely on the antd providers being mounted.
 */
export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 22 }}>There is nothing at this address</h1>
      <p style={{ margin: 0, opacity: 0.65 }}>
        The link may be out of date, or the page may have moved.
      </p>
      <Link href={DEFAULT_ROUTE} style={{ marginTop: 8 }}>
        Go to uploads
      </Link>
    </div>
  );
}
