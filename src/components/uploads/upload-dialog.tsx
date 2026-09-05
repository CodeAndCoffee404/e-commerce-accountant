"use client";

import {
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  InboxOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { uploadPresigned } from "@vercel/blob/client";
import {
  App,
  Button,
  List,
  Modal,
  Progress,
  Space,
  Spin,
  Tag,
  theme,
  Typography,
  Upload,
} from "antd";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatSize } from "@/lib/format";
import { MAX_UPLOAD_BYTES, UPLOAD_ACCEPT } from "@/lib/uploads/constants";
import { uploadPath } from "@/lib/uploads/paths";
import { registerUpload } from "@/lib/uploads/register";

type Stage = "queued" | "uploading" | "processing" | "done" | "error";

type Item = {
  id: string;
  file: File;
  stage: Stage;
  /**
   * What the bar shows. Not a measurement.
   *
   * Only part of this is knowable. The transfer reports real percentages, and
   * on a small file it reports them once — 0, then 100 — so nothing appears to
   * move; the server then parses the file and stores its rows, which is the
   * longer half on a big export and reports nothing at all.
   *
   * So the number creeps on a timer and the real figures only ever push it
   * higher. It is deliberately fake, and honest in the one way that matters:
   * it never reaches 100 until the work is actually finished, so a stalled
   * upload cannot look like a finished one.
   */
  progress: number;
  summary?: string;
  error?: string;
};

/** Where the creep stops and waits, per stage. */
const CEILING: Partial<Record<Stage, number>> = { uploading: 92, processing: 99 };

export function UploadDialog({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const counter = useRef(0);
  const creeps = useRef(new Map<string, ReturnType<typeof setInterval>>());

  const patch = useCallback((id: string, change: Partial<Item>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }, []);

  const stopCreep = useCallback((id: string) => {
    const timer = creeps.current.get(id);

    if (timer) {
      clearInterval(timer);
      creeps.current.delete(id);
    }
  }, []);

  /**
   * Moves the number along while nothing else is reporting.
   *
   * Decelerating, so it slows as it approaches the stage's ceiling instead of
   * arriving and sitting still: the point is to look like work in progress,
   * and a bar parked at its maximum reads exactly like a hang.
   */
  const startCreep = useCallback(
    (id: string) => {
      stopCreep(id);

      const timer = setInterval(() => {
        setItems((current) =>
          current.map((item) => {
            if (item.id !== id) return item;

            const ceiling = CEILING[item.stage];

            if (ceiling === undefined || item.progress >= ceiling) return item;

            return {
              ...item,
              progress: Math.min(ceiling, item.progress + Math.max(0.3, (ceiling - item.progress) / 14)),
            };
          }),
        );
      }, 220);

      creeps.current.set(id, timer);
    },
    [stopCreep],
  );

  // Nothing may outlive the dialog: a closed modal that is still ticking would
  // keep re-rendering a list nobody is looking at.
  useEffect(() => {
    const timers = creeps.current;

    return () => {
      for (const timer of timers.values()) clearInterval(timer);
      timers.clear();
    };
  }, []);

  const add = (file: File) => {
    counter.current += 1;

    setItems((current) => [
      ...current,
      {
        id: `${counter.current}-${file.name}`,
        file,
        stage: "queued",
        progress: 0,
        // Caught here rather than after a two-minute upload that the server
        // would refuse anyway.
        ...(file.size > MAX_UPLOAD_BYTES
          ? { stage: "error" as const, error: "Larger than 20 MB." }
          : {}),
      },
    ]);
  };

  const uploadOne = async (item: Item): Promise<boolean> => {
    patch(item.id, { stage: "uploading", progress: 0 });
    startCreep(item.id);

    try {
      // Straight to Blob storage over a presigned URL. A Server Action would
      // cap the file at the 4.5 MB request body limit of Vercel functions.
      // Scoped to the tenant and unique per upload: the server refuses to sign
      // anything else, and reusing a key would leave an earlier record pointing
      // at another file's bytes.
      const blob = await uploadPresigned(
        uploadPath(tenantId, item.file.name, crypto.randomUUID()),
        item.file,
        {
          access: "private",
          handleUploadUrl: "/api/uploads/blob",
          contentType: item.file.type || undefined,
          // Upwards only. The creep may already be ahead of the transfer on a
          // small file, and a number that jumped backwards would be worse
          // than one that is approximate.
          onUploadProgress: ({ percentage }) =>
            setItems((current) =>
              current.map((row) =>
                row.id === item.id ? { ...row, progress: Math.max(row.progress, percentage) } : row,
              ),
            ),
        },
      );

      // Not 100: the bytes have arrived, the work has not finished. The creep
      // carries on from wherever it is, up to the processing ceiling.
      patch(item.id, { stage: "processing" });

      const result = await registerUpload({
        pathname: blob.pathname,
        url: blob.url,
        filename: item.file.name,
        contentType: item.file.type || undefined,
      });

      if (!result.ok) {
        stopCreep(item.id);
        patch(item.id, { stage: "error", error: result.message });

        return false;
      }

      const parts = [result.label, result.period, `${result.transactions} rows`];

      if (result.supersededRows > 0) parts.push(`replaced ${result.supersededRows}`);
      if (result.needsAttention > 0) parts.push(`${result.needsAttention} to review`);

      stopCreep(item.id);
      patch(item.id, { stage: "done", progress: 100, summary: parts.join(" · ") });

      return true;
    } catch (error) {
      stopCreep(item.id);
      patch(item.id, {
        stage: "error",
        error: error instanceof Error ? error.message : "The file could not be uploaded.",
      });

      return false;
    }
  };

  const uploadAll = async () => {
    setRunning(true);

    // One at a time. The server reads every row of a file and holds it in
    // memory to do so, and several at once would compete for that to nobody's
    // benefit — while a queue can say which file it is on.
    let accepted = 0;

    for (const item of items) {
      if (item.stage === "done" || item.stage === "error") continue;
      if (await uploadOne(item)) accepted += 1;
    }

    setRunning(false);
    router.refresh();

    if (accepted > 0) message.success(`${accepted} file${accepted === 1 ? "" : "s"} added.`);
  };

  const pending = items.filter((item) => item.stage === "queued").length;
  const settled = items.filter((item) => item.stage === "done" || item.stage === "error").length;

  const close = () => {
    setOpen(false);

    // Cleared on close so opening it again starts on a clean sheet rather than
    // on yesterday's list — unless the queue is still going, in which case it
    // carries on in the background and reopening shows where it got to.
    if (!running) setItems([]);
  };

  return (
    <>
      {/* Default, not primary: on the dashboard this sits beside Build, and
          two filled buttons side by side compete for the one action that
          actually finishes the month. */}
      <Button icon={<UploadOutlined />} onClick={() => setOpen(true)}>
        Upload files
      </Button>

      <Modal
        open={open}
        title="Upload channel exports"
        width={680}
        centered
        onCancel={close}
        maskClosable={!running}
        // Closable throughout: what has already been accepted is saved, and
        // trapping someone in a dialog because a queue is running is rude.
        closable
        footer={
          <Space>
            <Button onClick={close}>{settled > 0 && !running ? "Done" : "Close"}</Button>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              loading={running}
              disabled={pending === 0}
              onClick={uploadAll}
            >
              {running
                ? "Uploading…"
                : pending === 0
                  ? "Nothing to upload"
                  : `Upload ${pending} file${pending === 1 ? "" : "s"}`}
            </Button>
          </Space>
        }
      >
        <Upload.Dragger
          name="file"
          multiple
          accept={UPLOAD_ACCEPT}
          showUploadList={false}
          disabled={running}
          beforeUpload={(file) => {
            add(file);

            // Collected, not sent: the whole set is assembled first and the
            // button starts it.
            return false;
          }}
          style={{ marginBottom: 16 }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">Drop files here, or click to choose</p>
          <p className="ant-upload-hint">
            CSV and XLSX, up to 20 MB each. Add as many as you like and upload them in one go.
          </p>
        </Upload.Dragger>

        {items.length === 0 ? (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Upload each file exactly as the channel exported it. The type, the country and the
            period are read from inside the file, so renaming one changes nothing.
          </Typography.Paragraph>
        ) : (
          <>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {running
                ? `Uploading — ${settled} of ${items.length} finished`
                : `${items.length} file${items.length === 1 ? "" : "s"} in the queue`}
            </Typography.Text>

            <div style={{ maxHeight: "40vh", overflowY: "auto" }}>
              <List
                size="small"
                dataSource={items}
                rowKey="id"
                // A long queue scrolls inside the dialog rather than pushing the
                // buttons off the bottom of the screen.
                renderItem={(item) => (
                  <List.Item
                    actions={
                      item.stage === "queued" && !running
                        ? [
                            <Button
                              key="remove"
                              type="text"
                              size="small"
                              icon={<DeleteOutlined />}
                              aria-label={`Remove ${item.file.name}`}
                              onClick={() =>
                                setItems((current) =>
                                  current.filter((candidate) => candidate.id !== item.id),
                                )
                              }
                            />,
                          ]
                        : undefined
                    }
                  >
                    <List.Item.Meta
                      avatar={
                        item.stage === "done" ? (
                          <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 18 }} />
                        ) : item.stage === "error" ? (
                          <CloseCircleFilled style={{ color: token.colorError, fontSize: 18 }} />
                        ) : item.stage === "processing" ? (
                          <Spin size="small" />
                        ) : (
                          <InboxOutlined
                            style={{
                              color: token.colorTextQuaternary,
                              fontSize: 18,
                            }}
                          />
                        )
                      }
                      title={
                        <Space size={8} wrap style={{ rowGap: 0 }}>
                          <Typography.Text ellipsis style={{ maxWidth: 340 }}>
                            {item.file.name}
                          </Typography.Text>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {formatSize(item.file.size)}
                          </Typography.Text>
                          {item.stage === "queued" ? <Tag>waiting</Tag> : null}
                        </Space>
                      }
                      description={
                        item.stage === "uploading" || item.stage === "processing" ? (
                          <Space direction="vertical" size={2} style={{ width: "100%" }}>
                            {/* No number. It would be a made-up one — see
                                `progress` — and what the bar is for is the
                                single fact that something is happening. */}
                            <Progress
                              percent={item.progress}
                              size="small"
                              status="active"
                              showInfo={false}
                              style={{ marginBottom: 0 }}
                            />
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {item.stage === "uploading"
                                ? "Sending the file…"
                                : "Recognising the file and storing its rows…"}
                            </Typography.Text>
                          </Space>
                        ) : (
                          <Typography.Text
                            type={item.stage === "error" ? "danger" : "secondary"}
                            style={{ fontSize: 12 }}
                          >
                            {item.stage === "done"
                              ? item.summary
                              : item.stage === "error"
                                ? item.error
                                : "Waiting its turn"}
                          </Typography.Text>
                        )
                      }
                    />
                  </List.Item>
                )}
              />
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
