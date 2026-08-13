"use client";

import { Card, Empty, Typography } from "antd";

/**
 * Placeholder for screens that arrive in a later stage. Naming the stage keeps
 * the shell honest about what is and is not built yet.
 */
export function ComingSoon({ stage }: { stage: string }) {
  return (
    <Card>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Typography.Text type="secondary">
            Arrives in {stage}.
          </Typography.Text>
        }
      />
    </Card>
  );
}