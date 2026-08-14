"use client";

import { FolderOpenOutlined, GoogleOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Popconfirm, Space, Tag, Typography } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { chooseFolder, disconnectDrive, pickerToken } from "@/lib/google/actions";
import type { ConnectionSummary } from "@/lib/google/connection";

/** Messages for the outcomes the OAuth callback can redirect back with. */
const OUTCOMES: Record<string, { type: "success" | "error" | "warning"; text: string }> = {
  connected: { type: "success", text: "Google connected. Now choose a folder." },
  cancelled: { type: "warning", text: "You cancelled the consent in Google's window." },
  state: {
    type: "error",
    text: "The request failed its check. Start connecting again from this page.",
  },
  nocode: { type: "error", text: "Google returned no authorisation code." },
  norefresh: {
    type: "error",
    text: "Google issued no long-lived token. Revoke this app in your Google account, then connect again.",
  },
  failed: { type: "error", text: "The code could not be exchanged for a token." },
  forbidden: { type: "error", text: "Not allowed to connect Drive." },
};

type PickerApi = {
  load: (name: string, callback: () => void) => void;
};

declare global {
  interface Window {
    gapi?: PickerApi;
    google?: {
      picker: {
        PickerBuilder: new () => PickerBuilder;
        ViewId: { FOLDERS: string };
        DocsView: new (viewId: string) => DocsView;
        Action: { PICKED: string };
        Feature: { SUPPORT_DRIVES: string };
      };
    };
  }
}

type DocsView = {
  setIncludeFolders: (value: boolean) => DocsView;
  setSelectFolderEnabled: (value: boolean) => DocsView;
  setMimeTypes: (value: string) => DocsView;
};

type PickerBuilder = {
  addView: (view: DocsView) => PickerBuilder;
  enableFeature: (feature: string) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setTitle: (title: string) => PickerBuilder;
  setCallback: (callback: (data: PickerResponse) => void) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};

type PickerResponse = {
  action: string;
  docs?: { id: string; name: string }[];
};

function loadPicker(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.picker) {
      resolve();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>("script[data-google-api]");
    const onReady = () => {
      window.gapi?.load("picker", () => resolve());
    };

    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      if (window.gapi) onReady();
      return;
    }

    const script = document.createElement("script");

    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.dataset.googleApi = "true";
    script.onload = onReady;
    script.onerror = () => reject(new Error("Could not load the Google picker."));

    document.head.append(script);
  });
}

export function DriveCard({
  connection,
  apiKey,
  canEdit,
}: {
  connection: ConnectionSummary;
  apiKey: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { message } = App.useApp();
  const [pending, startTransition] = useTransition();
  const [picking, setPicking] = useState(false);

  const outcome = OUTCOMES[params.get("drive") ?? ""];

  const pick = async () => {
    if (!apiKey) {
      message.error("GOOGLE_PICKER_API_KEY is not set — the folder chooser cannot open without it.", 10);
      return;
    }

    setPicking(true);

    try {
      const token = await pickerToken();

      if (!token.ok) {
        message.error(token.message, 8);
        return;
      }

      await loadPicker();

      const picker = window.google!.picker;
      const view = new picker.DocsView(picker.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes("application/vnd.google-apps.folder");

      new picker.PickerBuilder()
        .addView(view)
        .enableFeature(picker.Feature.SUPPORT_DRIVES)
        .setOAuthToken(token.token)
        .setDeveloperKey(apiKey)
        .setTitle("Where reports should be written")
        .setCallback((data) => {
          if (data.action !== picker.Action.PICKED) return;

          const folder = data.docs?.[0];

          if (!folder) return;

          startTransition(async () => {
            const result = await chooseFolder({ folderId: folder.id });

            if (result.ok) message.success(result.message, 6);
            else message.error(result.message, 8);

            router.refresh();
          });
        })
        .build()
        .setVisible(true);
    } catch (error) {
      message.error((error as Error).message, 8);
    } finally {
      setPicking(false);
    }
  };

  return (
    <Card size="small" title="Google Drive">
      {outcome ? (
        <Alert type={outcome.type} showIcon message={outcome.text} style={{ marginBottom: 16 }} />
      ) : null}

      <Typography.Paragraph type="secondary">
        Finished reports are written to a folder in your Google Drive. The app asks only for
        the files it creates itself and the folder you point it at — the rest of your Drive
        stays invisible to it.
      </Typography.Paragraph>

      {connection === null ? (
        <Button
          type="primary"
          icon={<GoogleOutlined />}
          disabled={!canEdit}
          href="/api/google/connect"
        >
          Connect Google Drive
        </Button>
      ) : (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space wrap>
            <Tag color={connection.status === "connected" ? "green" : "orange"}>
              {connection.status}
            </Tag>
            <Typography.Text>{connection.email}</Typography.Text>
          </Space>

          {connection.folderName ? (
            <Typography.Text>
              Folder: <b>{connection.folderName}</b>
            </Typography.Text>
          ) : (
            <Alert type="warning" showIcon message="No folder chosen — reports are not being uploaded anywhere yet." />
          )}

          {connection.lastError ? (
            <Alert type="error" showIcon message={connection.lastError} />
          ) : null}

          <Space wrap>
            <Button
              icon={<FolderOpenOutlined />}
              loading={picking || pending}
              disabled={!canEdit}
              onClick={pick}
            >
              {connection.folderName ? "Change folder" : "Choose folder"}
            </Button>

            <Button href="/api/google/connect" disabled={!canEdit}>
              Reconnect
            </Button>

            <Popconfirm
              title="Disconnect Google Drive?"
              description="Files already uploaded stay where they are."
              disabled={!canEdit}
              onConfirm={() =>
                startTransition(async () => {
                  const result = await disconnectDrive();

                  if (result.ok) message.success(result.message);
                  else message.error(result.message);

                  router.refresh();
                })
              }
            >
              <Button danger disabled={!canEdit}>
                Disconnect
              </Button>
            </Popconfirm>
          </Space>
        </Space>
      )}
    </Card>
  );
}
