"use server";

import { can, requireAccess } from "@/lib/auth/session";

import { transactionSource } from "./queries";

export type SourceRow = {
  filename: string;
  rowNumber: number;
  raw: Record<string, string>;
} | null;

/**
 * Fetched on demand rather than loaded with the table: the stored row is the
 * whole original line, personal data included, and there is no reason to send
 * fifty of them to a browser that will look at one.
 */
export async function loadSourceRow(transactionId: string): Promise<SourceRow> {
  const user = await requireAccess();

  // The same rows back both the ledger and the expander under a source file,
  // so either section being open is reason enough to hand one over.
  if (!can(user, "transactions", "view") && !can(user, "source_files", "view")) return null;

  return transactionSource(user.tenantId, transactionId);
}
