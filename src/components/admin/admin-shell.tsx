"use client";

import { Layout } from "antd";
import type { ReactNode } from "react";

/**
 * The admin area's frame.
 *
 * A client component, and it has to be: antd's compound components —
 * `Layout.Content` here, `Card.Meta` and `Typography.Text` elsewhere — cannot
 * be reached from a Server Component. antd marks its modules `"use client"`,
 * so what a Server Component imports is an opaque client reference, and the
 * pieces hung off it as properties come back `undefined`. React then refuses
 * to render with "Element type is invalid … but got: undefined", which is a
 * 500 on the whole route rather than anything the guard above it could catch.
 *
 * The dashboard has always done it this way — its shell is `AppShell`, also a
 * client component. This is the same arrangement for the screen above the
 * companies.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <Layout style={{ minHeight: "100dvh" }}>
      <Layout.Content
        style={{
          padding: "clamp(16px, 4vw, 40px)",
          maxWidth: 1100,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {children}
      </Layout.Content>
    </Layout>
  );
}
