"use client";

import { ExportOutlined } from "@ant-design/icons";
import { Button, Modal, Typography } from "antd";
import { useState } from "react";

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
 */

/**
 * Drive's own embeddable address for a file, from the link it gave us.
 *
 * `webViewLink` is what the API returns and what is stored, in one of two
 * shapes depending on the file: `/file/d/<id>/view` for an uploaded workbook,
 * `/spreadsheets/d/<id>/edit` once Drive has converted it to Sheets. Both
 * carry the id in the same place, and both preview from `/file/d/<id>/preview`.
 *
 * Null when the link is neither — a shape Google has not shown us — because
 * guessing at an id would put an empty frame on the screen with no way to tell
 * why.
 */
export function drivePreviewUrl(driveUrl: string): string | null {
  const id = /\/d\/([A-Za-z0-9_-]{10,})/.exec(driveUrl)?.[1];

  return id ? `https://drive.google.com/file/d/${id}/preview` : null;
}

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
        <Button icon={<ExportOutlined />} href={driveUrl} target="_blank" rel="noreferrer">
          Open in Drive
        </Button>
      }
      destroyOnHidden
      // The frame is the content: padding around it would only make the
      // window it sits in smaller.
      styles={{ body: { padding: 0, height: "min(70vh, 720px)" } }}
    >
      {preview ? (
        <iframe
          src={preview}
          title={title}
          style={{ width: "100%", height: "100%", border: 0 }}
          // Drive's own page, in a frame that can do nothing else.
          sandbox="allow-scripts allow-same-origin allow-popups"
          allow="autoplay"
        />
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
