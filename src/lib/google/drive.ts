const UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files";
const FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";

export type DriveFile = {
  id: string;
  name: string;
  webViewLink: string;
};

/**
 * Uploads a file into a folder the user picked.
 *
 * Multipart rather than resumable: reports are a few hundred kilobytes, and a
 * resumable upload costs an extra round trip to buy recovery this size does not
 * need.
 */
export async function uploadFile(
  accessToken: string,
  input: {
    name: string;
    parentFolderId: string;
    mimeType: string;
    bytes: Uint8Array;
  },
): Promise<DriveFile> {
  const boundary = `ea-${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({
    name: input.name,
    parents: [input.parentFolderId],
  });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\ncontent-type: ${input.mimeType}\r\n\r\n`,
    ),
    Buffer.from(input.bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const response = await fetch(
    `${UPLOAD_ENDPOINT}?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body: new Uint8Array(body),
    },
  );

  if (!response.ok) {
    throw new Error(`Google Drive отказал: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as DriveFile;
}

/**
 * Creates a subfolder, or returns the one already there.
 *
 * Reports go into a folder per period, the way legacy organised them, so a
 * month's files stay together rather than piling into one directory.
 */
export async function ensureFolder(
  accessToken: string,
  parentFolderId: string,
  name: string,
): Promise<string> {
  const query = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `'${parentFolderId}' in parents`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ].join(" and ");

  const found = await fetch(
    `${FILES_ENDPOINT}?q=${encodeURIComponent(query)}&fields=files(id)&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );

  if (found.ok) {
    const body = (await found.json()) as { files?: { id: string }[] };

    if (body.files?.[0]) return body.files[0].id;
  }

  const created = await fetch(`${FILES_ENDPOINT}?fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name,
      parents: [parentFolderId],
      mimeType: "application/vnd.google-apps.folder",
    }),
  });

  if (!created.ok) {
    throw new Error(`Не удалось создать папку в Drive: ${await created.text()}`);
  }

  return ((await created.json()) as { id: string }).id;
}

/**
 * Confirms the picked folder is still reachable. Called when the folder is
 * chosen, so a mistake surfaces then rather than a month later when a report
 * has nowhere to go.
 */
export async function folderName(
  accessToken: string,
  folderId: string,
): Promise<string | null> {
  const response = await fetch(
    `${FILES_ENDPOINT}/${folderId}?fields=id,name,mimeType&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) return null;

  const body = (await response.json()) as { name?: string; mimeType?: string };

  if (body.mimeType !== "application/vnd.google-apps.folder") return null;

  return body.name ?? null;
}
