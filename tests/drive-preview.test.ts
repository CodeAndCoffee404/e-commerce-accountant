import { describe, expect, it } from "vitest";

import { drivePreviewUrl } from "@/lib/google/preview";

/**
 * Where a published report is shown from.
 *
 * The preview window came up empty for every report, which was not a frame
 * that failed to load: reports are converted to Sheets on upload, and a native
 * Sheets file does not preview from Drive's file viewer — that address
 * redirects to the editor, and the editor sends headers that forbid framing.
 * So the address has to follow the link's shape rather than assume one.
 */

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

describe("the preview address for a published file", () => {
  it("takes a converted workbook to the Sheets preview, not to Drive", () => {
    // What `webViewLink` actually holds for a report: Drive converts on
    // import, so this is the shape nearly every row here has.
    expect(drivePreviewUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=drivesdk`)).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/preview`,
    );
  });

  it("takes a stored file to Drive's own viewer", () => {
    expect(drivePreviewUrl(`https://drive.google.com/file/d/${ID}/view?usp=drivesdk`)).toBe(
      `https://drive.google.com/file/d/${ID}/preview`,
    );
  });

  it("knows the other editors by the same rule", () => {
    expect(drivePreviewUrl(`https://docs.google.com/document/d/${ID}/edit`)).toBe(
      `https://docs.google.com/document/d/${ID}/preview`,
    );
    expect(drivePreviewUrl(`https://docs.google.com/presentation/d/${ID}/edit`)).toBe(
      `https://docs.google.com/presentation/d/${ID}/preview`,
    );
  });

  it("says nothing rather than guessing at an address it does not know", () => {
    // A frame pointed at a guess is an empty window with no way to tell why —
    // the screen says so in words instead.
    expect(drivePreviewUrl("https://drive.google.com/drive/folders/xyz")).toBeNull();
    expect(drivePreviewUrl("")).toBeNull();
  });
});
