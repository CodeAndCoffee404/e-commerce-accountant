import { eq } from "drizzle-orm";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";

import { refreshAccessToken } from "./oauth";

export type ConnectionSummary = {
  email: string;
  folderId: string | null;
  folderName: string | null;
  status: string;
  lastError: string | null;
  connectedAt: Date;
} | null;

export async function loadConnection(tenantId: string): Promise<ConnectionSummary> {
  const [row] = await getDb()
    .select({
      email: schema.googleConnections.googleAccountEmail,
      folderId: schema.googleConnections.rootFolderId,
      folderName: schema.googleConnections.rootFolderName,
      status: schema.googleConnections.status,
      lastError: schema.googleConnections.lastError,
      connectedAt: schema.googleConnections.connectedAt,
    })
    .from(schema.googleConnections)
    .where(eq(schema.googleConnections.tenantId, tenantId))
    .limit(1);

  return row ?? null;
}

export async function saveConnection(input: {
  tenantId: string;
  email: string;
  refreshToken: string;
  scope: string;
  connectedBy: string | null;
}): Promise<void> {
  const encrypted = encryptSecret(input.refreshToken);
  const db = getDb();

  // Reconnecting keeps the chosen folder: the usual reason to reconnect is an
  // expired grant, and making the client pick the folder again for that would
  // be a chore with no purpose.
  await db
    .insert(schema.googleConnections)
    .values({
      tenantId: input.tenantId,
      googleAccountEmail: input.email,
      refreshTokenEncrypted: encrypted,
      scope: input.scope,
      status: "needs_folder",
      connectedBy: input.connectedBy,
    })
    .onConflictDoUpdate({
      target: schema.googleConnections.tenantId,
      set: {
        googleAccountEmail: input.email,
        refreshTokenEncrypted: encrypted,
        scope: input.scope,
        lastError: null,
        connectedAt: new Date(),
        connectedBy: input.connectedBy,
      },
    });

  await refreshStatus(input.tenantId);
}

export async function setFolder(
  tenantId: string,
  folderId: string,
  folderName: string,
): Promise<void> {
  await getDb()
    .update(schema.googleConnections)
    .set({ rootFolderId: folderId, rootFolderName: folderName, status: "connected", lastError: null })
    .where(eq(schema.googleConnections.tenantId, tenantId));
}

export async function disconnect(tenantId: string): Promise<void> {
  await getDb()
    .delete(schema.googleConnections)
    .where(eq(schema.googleConnections.tenantId, tenantId));
}

/**
 * A working access token, or null when the connection can no longer produce
 * one. Revocation is recorded rather than thrown: the caller is usually a
 * report run, and a revoked Drive must not fail the report.
 */
export async function accessTokenFor(tenantId: string): Promise<string | null> {
  const db = getDb();

  const [row] = await db
    .select({
      refreshTokenEncrypted: schema.googleConnections.refreshTokenEncrypted,
    })
    .from(schema.googleConnections)
    .where(eq(schema.googleConnections.tenantId, tenantId))
    .limit(1);

  if (!row) return null;

  try {
    return await refreshAccessToken(decryptSecret(row.refreshTokenEncrypted));
  } catch (error) {
    await db
      .update(schema.googleConnections)
      .set({ status: "revoked", lastError: (error as Error).message })
      .where(eq(schema.googleConnections.tenantId, tenantId));

    return null;
  }
}

async function refreshStatus(tenantId: string): Promise<void> {
  const db = getDb();

  const [row] = await db
    .select({ folderId: schema.googleConnections.rootFolderId })
    .from(schema.googleConnections)
    .where(eq(schema.googleConnections.tenantId, tenantId))
    .limit(1);

  await db
    .update(schema.googleConnections)
    .set({ status: row?.folderId ? "connected" : "needs_folder" })
    .where(eq(schema.googleConnections.tenantId, tenantId));
}
