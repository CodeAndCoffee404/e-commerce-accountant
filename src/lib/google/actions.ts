"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";

import { accessTokenFor, disconnect, loadConnection, setFolder } from "./connection";
import { folderName } from "./drive";

export type DriveResult = { ok: true; message: string } | { ok: false; message: string };

async function requireEditor() {
  const user = await requireUser();

  if (user.role === "viewer") throw new Error("Недостаточно прав.");

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
    return { ok: false, message: "Доступ к Google отозван — подключите аккаунт заново." };
  }

  return { ok: true, token };
}

const folderSchema = z.object({
  folderId: z.string().trim().min(1),
});

export async function chooseFolder(input: unknown): Promise<DriveResult> {
  const user = await requireEditor();
  const parsed = folderSchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: "Папка не выбрана." };

  const token = await accessTokenFor(user.tenantId);

  if (!token) return { ok: false, message: "Доступ к Google отозван — подключите аккаунт заново." };

  // Checked now rather than at the first report: a folder that cannot be
  // reached should say so while the client is still looking at the screen.
  const name = await folderName(token, parsed.data.folderId);

  if (!name) {
    return { ok: false, message: "Не удалось открыть выбранную папку. Выберите её ещё раз." };
  }

  await setFolder(user.tenantId, parsed.data.folderId, name);

  revalidatePath("/settings");

  return { ok: true, message: `Отчёты будут складываться в «${name}».` };
}

export async function disconnectDrive(): Promise<DriveResult> {
  const user = await requireEditor();

  await disconnect(user.tenantId);

  revalidatePath("/settings");

  return {
    ok: true,
    message: "Google Drive отключён. Уже выгруженные файлы остаются на месте.",
  };
}

export async function driveStatus() {
  const user = await requireUser();

  return loadConnection(user.tenantId);
}
