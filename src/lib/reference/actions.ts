"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";

import { refreshFxRates } from "./fx";
import { seedReferenceData } from "./seed";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Owners and accountants may change reference data; a viewer may not. The check
 * lives here rather than in the interface, because a Server Action is a public
 * endpoint whatever the interface chooses to render.
 */
async function requireEditor() {
  const user = await requireUser();

  if (user.role === "viewer") throw new Error("Not allowed to change reference data.");

  return user;
}

const vatRateSchema = z.object({
  id: z.string().uuid().optional(),
  country: z.string().trim().min(2).max(2).toUpperCase(),
  // A rate is a percent. Stored as text so it never passes through a float.
  rate: z.string().trim().regex(/^\d+(\.\d+)?$/, "A rate is a number, for example 21 or 5.5"),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

// `unknown` on purpose: a Server Action is a public endpoint, and whatever the
// interface believes it sends, the request can carry anything. zod decides.
export async function saveVatRate(input: unknown): Promise<ActionResult> {
  const user = await requireEditor();
  const parsed = vatRateSchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const { id, ...values } = parsed.data;
  const db = getDb();

  if (id) {
    await db
      .update(schema.vatRates)
      .set({ ...values, validTo: values.validTo ?? null, note: values.note ?? null })
      .where(and(eq(schema.vatRates.id, id), eq(schema.vatRates.tenantId, user.tenantId)));
  } else {
    await db.insert(schema.vatRates).values({
      tenantId: user.tenantId,
      ...values,
      validTo: values.validTo ?? null,
      note: values.note ?? null,
    });
  }

  await audit(user, id ? "vat_rate.updated" : "vat_rate.created", "vat_rate", id, values);
  revalidatePath("/settings");

  return { ok: true, message: `Rate for ${values.country} saved.` };
}

export async function deleteVatRate(id: string): Promise<ActionResult> {
  const user = await requireEditor();

  await getDb()
    .delete(schema.vatRates)
    .where(and(eq(schema.vatRates.id, id), eq(schema.vatRates.tenantId, user.tenantId)));

  await audit(user, "vat_rate.deleted", "vat_rate", id);
  revalidatePath("/settings");

  return { ok: true, message: "Rate deleted." };
}

const skuSchema = z.object({
  id: z.string().uuid().optional(),
  channel: z.string().trim().min(1),
  sourceSku: z.string().trim().min(1),
  targetSku: z.string().trim().nullable().optional(),
  itemName: z.string().trim().nullable().optional(),
  isIgnored: z.boolean(),
});

export async function saveSkuMapping(input: unknown): Promise<ActionResult> {
  const user = await requireEditor();
  const parsed = skuSchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const { id, ...values } = parsed.data;
  const db = getDb();

  if (id) {
    await db
      .update(schema.skuMappings)
      .set({
        ...values,
        targetSku: values.targetSku || null,
        itemName: values.itemName || null,
      })
      .where(and(eq(schema.skuMappings.id, id), eq(schema.skuMappings.tenantId, user.tenantId)));
  } else {
    await db
      .insert(schema.skuMappings)
      .values({
        tenantId: user.tenantId,
        ...values,
        targetSku: values.targetSku || null,
        itemName: values.itemName || null,
      })
      .onConflictDoNothing();
  }

  await audit(user, id ? "sku_mapping.updated" : "sku_mapping.created", "sku_mapping", id, values);
  revalidatePath("/settings");

  return { ok: true, message: `SKU ${values.sourceSku} saved.` };
}

export async function deleteSkuMapping(id: string): Promise<ActionResult> {
  const user = await requireEditor();

  await getDb()
    .delete(schema.skuMappings)
    .where(and(eq(schema.skuMappings.id, id), eq(schema.skuMappings.tenantId, user.tenantId)));

  await audit(user, "sku_mapping.deleted", "sku_mapping", id);
  revalidatePath("/settings");

  return { ok: true, message: "Entry deleted." };
}

export async function saveChannelRule(id: string, rawValue: string): Promise<ActionResult> {
  const user = await requireEditor();

  let value: unknown;

  try {
    value = JSON.parse(rawValue);
  } catch {
    return { ok: false, message: "The value has to be valid JSON." };
  }

  await getDb()
    .update(schema.channelRules)
    .set({ value })
    .where(and(eq(schema.channelRules.id, id), eq(schema.channelRules.tenantId, user.tenantId)));

  // The value itself goes into the entry: a channel rule is an assumption, and
  // "who changed it to what" is the question that gets asked later.
  await audit(user, "channel_rule.updated", "channel_rule", id, { value });
  revalidatePath("/settings");

  return { ok: true, message: "Rule saved." };
}

export async function refreshRates(full = false): Promise<ActionResult> {
  const user = await requireEditor();

  try {
    const stored = await refreshFxRates(full ? "historical" : "recent");

    await audit(user, "fx_rates.refreshed", "fx_rate", undefined, { stored, full });
    revalidatePath("/settings");

    return {
      ok: true,
      message:
        stored === 0
          ? "No new rates — the cache is already up to date."
          : `Stored ${stored} new quotes.`,
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

/** Restores anything a tenant is missing, without overwriting edited values. */
export async function restoreDefaults(): Promise<ActionResult> {
  const user = await requireEditor();
  const result = await seedReferenceData(user.tenantId);
  const added =
    result.vatRates + result.sellerVatNumbers + result.skuMappings + result.channelRules;

  await audit(user, "reference.restored", "reference", undefined, result);
  revalidatePath("/settings");

  return {
    ok: true,
    message:
      added === 0
        ? "Nothing missing, nothing to add."
        : `Restored ${added} entries. Anything you had edited was left alone.`,
  };
}

/** Shorthand: every action here has the same actor shape. */
async function audit(
  user: { id: string; email: string; tenantId: string },
  action: string,
  entity: string,
  entityId?: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await record({ id: user.id, email: user.email, tenantId: user.tenantId }, {
    action,
    entity,
    entityId,
    payload,
  });
}
