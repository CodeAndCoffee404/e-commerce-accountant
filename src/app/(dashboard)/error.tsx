"use client";

import { Button, Result, Typography } from "antd";
import { useEffect } from "react";

/**
 * What a screen shows when it throws.
 *
 * The message itself is shown rather than hidden behind "something went wrong":
 * these are accountants reconciling figures, and "no VAT rate for GB" tells
 * them what to fix, while a generic apology tells them to call someone.
 *
 * The digest is included because a production build replaces server error
 * messages with it, and it is the only handle support has on the logs.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Result
      status="error"
      title="This page could not be loaded"
      subTitle={
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {error.message || "The server did not say why."}
          {error.digest ? (
            <>
              <br />
              <Typography.Text code copyable style={{ fontSize: 12 }}>
                {error.digest}
              </Typography.Text>
            </>
          ) : null}
        </Typography.Paragraph>
      }
      extra={[
        <Button type="primary" key="retry" onClick={reset}>
          Try again
        </Button>,
        <Button key="uploads" href="/uploads">
          Back to uploads
        </Button>,
      ]}
    />
  );
}
