"use server";

import { requireUser } from "@/lib/auth/session";

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
  const user = await requireUser();

  return transactionSource(user.tenantId, transactionId);
}
