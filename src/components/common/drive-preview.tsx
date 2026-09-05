"use client";

import { ExportOutlined } from "@ant-design/icons";
import { Button, Modal, Typography } from "antd";
import { useState } from "react";

import { drivePreviewUrl } from "@/lib/google/preview";

/**
 * A workbook shown where it was built, rather than somewhere else.
 *
 * Opening a report used to mean leaving: the only control was a link to Drive,
 * so glancing at a figure cost a tab and the way back. The preview puts the
 * same file on the screen you are already on.
 *
 * Only the preview can live here. Google serves `/preview` for embedding and
 * refuses to be framed anywhere else — the editor sends headers that forbid it
 * — so "open in Drive" stays a link to Drive, and it is a separate control
 * because the two are different intentions: looking at a number, and going to
 * work on the file.
 *
 * The frame can still come up empty for a reason that is not ours: Google
 * shows what the person signed into the browser may see, and if that is not
 * the account the workbook is shared with, it offers them a sign-in instead.
 * Hence the line under the frame, and the button that leaves.
 */
export function DrivePreviewModal({
  open,
  title,
  driveUrl,
  onClose,
}: {
  open: boolean;
  /** What the workbook is, named the way the screen names it. */
  title: string;
  driveUrl: string;
  onClose: () => void;
}) {
  const preview = drivePreviewUrl(driveUrl);

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      width="min(1100px, 96vw)"
      footer={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 12, textAlign: "left" }}>
            Google shows this to the account signed in to this browser. Empty or asking you to sign
            in means it is signed in as somebody else.
          </Typography.Text>
          <Button icon={<ExportOutlined />} href={driveUrl} target="_blank" rel="noreferrer">
            Open in Drive
          </Button>
        </div>
      }
      destroyOnHidden
      // The frame is the content: padding around it would only make the
      // window it sits in smaller.
      styles={{ body: { padding: 0, height: "min(70vh, 720px)" } }}
    >
      {preview ? (
        // No `sandbox` here. It bought nothing — the frame is another origin
        // and isolated by that alone — and it costs: the preview is a Google
        // application, and it needs storage and forms of its own to draw a
        // sheet at all.
        <iframe src={preview} title={title} style={{ width: "100%", height: "100%", border: 0 }} />
      ) : (
        <div style={{ padding: 24 }}>
          <Typography.Paragraph>
            This file cannot be shown here — Drive gave it an address we do not recognise. It opens
            in Drive as usual.
          </Typography.Paragraph>
        </div>
      )}
    </Modal>
  );
}

/** The trigger and its window together, for a row that has one workbook. */
export function useDrivePreview(driveUrl: string | null | undefined, title: string) {
  const [open, setOpen] = useState(false);

  return {
    canPreview: Boolean(driveUrl),
    open: () => setOpen(true),
    modal: driveUrl ? (
      <DrivePreviewModal
        open={open}
        title={title}
        driveUrl={driveUrl}
        onClose={() => setOpen(false)}
      />
    ) : null,
  };
}
