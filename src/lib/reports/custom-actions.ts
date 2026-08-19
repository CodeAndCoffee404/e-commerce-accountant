"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";

import {
  customReportKey,
  customReportName,
  customSliceConfigSchema,
  CUSTOM_REPORTS_CHANNEL,
} from "@/modules/reports/custom-slice-config";

export type CustomReportActionResult = { ok: boolean; message: string };

/**
 * Enough for every real request and small enough that the Reports page stays a
 * page. Named in the refusal, so the limit is a message rather than a mystery.
 */
const MAX_DEFINITIONS = 30;

/**
 * The same line the rest of Settings draws: company settings are the owner's
 * alone. Checked here rather than in the interface, because a Server Action is
 * a public endpoint whatever the interface renders.
 */
async function requireOwner() {
  const user = await requireUser();

  if (user.role !== "owner") throw new Error("Only the owner can change custom reports.");

  return user;
}

const saveSchema = customSliceConfigSchema.extend({
  /** Present when editing; a new definition gets its key from its name. */
  key: z.string().trim().min(1).max(100).optional(),
});

export async function saveCustomReport(input: unknown): Promise<CustomReportActionResult> {
  const user = await requireOwner();
  const parsed = saveSchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const { key, ...config } = parsed.data;
  const db = getDb();

  const existing = await db
    .select({ key: schema.channelRules.key, value: schema.channelRules.value })
    .from(schema.channelRules)
    .where(
      and(
        eq(schema.channelRules.tenantId, user.tenantId),
        eq(schema.channelRules.channel, CUSTOM_REPORTS_CHANNEL),
      ),
    );

  // Two definitions with one name would produce workbooks that read as the
  // same report. Filenames carry the name, so the name is the identity here.
  const taken = existing.find(
    (row) =>
      row.key !== key &&
      customReportName(row.value, row.key).toLowerCase() === config.name.toLowerCase(),
  );

  if (taken) {
    return { ok: false, message: `A custom report named "${config.name}" already exists.` };
  }

  if (key) {
    const [updated] = await db
      .update(schema.channelRules)
      .set({ value: config })
      .where(
        and(
          eq(schema.channelRules.tenantId, user.tenantId),
          eq(schema.channelRules.channel, CUSTOM_REPORTS_CHANNEL),
          eq(schema.channelRules.key, key),
        ),
      )
      .returning({ id: schema.channelRules.id });

    if (!updated) return { ok: false, message: "No such custom report — it may have been deleted." };

    await audit(user, "custom_report.updated", key, config);
    revalidate();

    return { ok: true, message: `"${config.name}" saved.` };
  }

  if (existing.length >= MAX_DEFINITIONS) {
    return {
      ok: false,
      message: `That would be definition ${MAX_DEFINITIONS + 1}; the limit is ${MAX_DEFINITIONS}. Delete one that is no longer used.`,
    };
  }

  // The key names this definition's runs forever, so it is derived once from
  // the name and never changes on rename.
  const keys = new Set(existing.map((row) => row.key));
  const base = customReportKey(config.name);
  let candidate = base;

  for (let suffix = 2; keys.has(candidate); suffix += 1) candidate = `${base}-${suffix}`;

  await db.insert(schema.channelRules).values({
    tenantId: user.tenantId,
    channel: CUSTOM_REPORTS_CHANNEL,
    key: candidate,
    value: config,
    note: "Custom report definition — edited on Settings -> Custom reports.",
  });

  await audit(user, "custom_report.created", candidate, config);
  revalidate();

  return { ok: true, message: `"${config.name}" created. It now has its own card on Reports.` };
}

export async function deleteCustomReport(key: string): Promise<CustomReportActionResult> {
  const user = await requireOwner();

  const [deleted] = await getDb()
    .delete(schema.channelRules)
    .where(
      and(
        eq(schema.channelRules.tenantId, user.tenantId),
        eq(schema.channelRules.channel, CUSTOM_REPORTS_CHANNEL),
        eq(schema.channelRules.key, key),
      ),
    )
    .returning({ value: schema.channelRules.value });

  if (!deleted) return { ok: false, message: "No such custom report." };

  await audit(user, "custom_report.deleted", key, { name: customReportName(deleted.value, key) });
  revalidate();

  // Already-built workbooks stay: they are results, not the definition.
  return { ok: true, message: "Definition deleted. Reports already built from it are kept." };
}

function revalidate() {
  revalidatePath("/settings");
  // The cards on Reports come from these definitions.
  revalidatePath("/reports");
}

async function audit(
  user: { id: string; email: string; tenantId: string },
  action: string,
  key: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    { action, entity: "custom_report", entityId: key, payload },
  );
}
