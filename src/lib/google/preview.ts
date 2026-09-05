/**
 * The embeddable address for a file we published, from the link Drive gave us.
 *
 * `webViewLink` is what the API returns and what is stored, and its shape says
 * what the file became. A report is uploaded as a workbook and converted on
 * import, so most of them come back as `/spreadsheets/d/<id>/edit` — a native
 * Sheets file, which is not a file in the Drive viewer's sense and does not
 * preview from `drive.google.com/file/...`: that address redirects to the
 * editor, and the editor refuses to be framed. That is the whole of why the
 * preview window came up empty. Each kind previews from its own editor host
 * instead, and only something Drive stores as a plain file (`/file/d/<id>`)
 * previews from Drive.
 *
 * Null when the link is neither shape — one Google has not shown us — because
 * guessing at an id would put an empty frame on the screen with no way to tell
 * why.
 */
export function drivePreviewUrl(driveUrl: string): string | null {
  const editor = /\/(spreadsheets|document|presentation)\/d\/([A-Za-z0-9_-]{10,})/.exec(driveUrl);

  if (editor) return `https://docs.google.com/${editor[1]}/d/${editor[2]}/preview`;

  const file = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(driveUrl)?.[1];

  return file ? `https://drive.google.com/file/d/${file}/preview` : null;
}
