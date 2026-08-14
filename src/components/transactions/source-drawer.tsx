"use client";

import { Descriptions, Drawer, Empty, Skeleton, Typography } from "antd";
import { useEffect, useState } from "react";

import { loadSourceRow, type SourceRow } from "@/lib/transactions/actions";

export function SourceDrawer({
  transactionId,
  onClose,
}: {
  transactionId: string | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={transactionId !== null}
      onClose={onClose}
      title="Source row"
      width="min(760px, 100%)"
      destroyOnHidden
    >
      {transactionId ? <SourceContent key={transactionId} transactionId={transactionId} /> : null}
    </Drawer>
  );
}

function SourceContent({ transactionId }: { transactionId: string }) {
  const [source, setSource] = useState<SourceRow | undefined>(undefined);

  useEffect(() => {
    let active = true;

    loadSourceRow(transactionId).then((result) => {
      if (active) setSource(result);
    });

    return () => {
      active = false;
    };
  }, [transactionId]);

  if (source === undefined) return <Skeleton active />;
  if (source === null) return <Empty description="Source row not found" />;

  const entries = Object.entries(source.raw);

  return (
    <>
      <Typography.Paragraph type="secondary">
        {source.filename} · row {source.rowNumber}
      </Typography.Paragraph>

      {entries.length === 0 ? (
        <Empty description="The original row was not stored" />
      ) : (
        <Descriptions bordered size="small" column={1} styles={{ label: { width: 260 } }}>
          {entries.map(([key, value]) => (
            <Descriptions.Item key={key} label={key}>
              {value}
            </Descriptions.Item>
          ))}
        </Descriptions>
      )}
    </>
  );
}
