"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";

import { accessTokenFor, disconnect, setFolder } from "./connection";
import { folderName } from "./drive";

export type DriveResult = { ok: true; message: string } | { ok: false; message: string };

async function requireEditor() {
  const user = await requireUser();

  if (user.role === "viewer") throw new Error("Not allowed.");

  return user;
}

/**
 * Hands the browser a short-lived access token so Google's picker can run.
 *
 * The picker is the only way a `drive.file` app can be given access to a folder
 * that already exists — an id typed in by hand carries no permission with it.
 * The token is minted per request, lives an hour, and can do nothing but touch
 * files this app created or the user selects.
 */
export async function pickerToken(): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  const user = await requireEditor();
  const token = await accessTokenFor(user.tenantId);

  if (!token) {
    return { ok: false, message: "Google access was revoked — connect the account again." };
  }

  return { ok: true, token };
}

const folderSchema = z.object({
  folderId: z.string().trim().min(1),
});

export async function chooseFolder(input: unknown): Promise<DriveResult> {
  const user = await requireEditor();
  const parsed = folderSchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: "No folder chosen." };

  const token = await accessTokenFor(user.tenantId);

  if (!token) return { ok: false, message: "Google access was revoked — connect the account again." };

  // Checked now rather than at the first report: a folder that cannot be
  // reached should say so while the client is still looking at the screen.
  const name = await folderName(token, parsed.data.folderId);

  if (!name) {
    return { ok: false, message: "That folder could not be opened. Please choose it again." };
  }

  await setFolder(user.tenantId, parsed.data.folderId, name);

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    {
      action: "drive.folder_chosen",
      entity: "google_connection",
      payload: { folderId: parsed.data.folderId, folderName: name },
    },
  );

  revalidatePath("/settings");

  return { ok: true, message: `Reports will be written to "${name}".` };
}

export async function disconnectDrive(): Promise<DriveResult> {
  const user = await requireEditor();

  await disconnect(user.tenantId);

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    { action: "drive.disconnected", entity: "google_connection" },
  );

  revalidatePath("/settings");

  return {
    ok: true,
    message: "Google Drive disconnected. Files already uploaded stay where they are.",
  };
}
