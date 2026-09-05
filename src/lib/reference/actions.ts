"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { can, inRequest, requireAccess } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";

import { refreshFxRates } from "./fx";
import { seedReferenceData } from "./seed";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Company settings are the owner's alone — the client drew the line there:
 * an accountant uploads, builds and deletes, but does not change what the
 * numbers are computed from. The check lives here rather than in the
 * interface, because a Server Action is a public endpoint whatever the
 * interface chooses to render.
 */
async function requireEditor() {
  const user = await requireAccess();

  if (!can(user, "settings_company", "edit")) {
    throw new Error("Your role cannot change company settings.");
  }

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
  return inRequest(() => saveVatRateInScope(input));
}

async function saveVatRateInScope(input: unknown): Promise<ActionResult> {
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
  return inRequest(() => deleteVatRateInScope(id));
}

async function deleteVatRateInScope(id: string): Promise<ActionResult> {
  const user = await requireEditor();

  await getDb()
    .delete(schema.vatRates)
    .where(and(eq(schema.vatRates.id, id), eq(schema.vatRates.tenantId, user.tenantId)));

  await audit(user, "vat_rate.deleted", "vat_rate", id);
  revalidatePath("/settings");

  return { ok: true, message: "Rate deleted." };
}

/** The day before a date, which is when the registration it replaces stops. */
function dayBefore(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);

  day.setUTCDate(day.getUTCDate() - 1);

  return day.toISOString().slice(0, 10);
}

const sellerVatSchema = z.object({
  /**
   * Required: a registration is never created here.
   *
   * Which registrations a company holds — the country and the regime each is
   * used under — follows from the reports it runs, and the rows were written
   * when the company was created. The number and the period it is in force for
   * are the company's own facts; the pair that finds it is not, and is never
   * read from the browser. It used to be, which meant an edit made for a note
   * could change the scheme of the one-stop registration and quietly take
   * every export sale out of Off-Amazon Sales.
   */
  id: z.string().uuid(),
  vatNumber: z
    .string()
    .trim()
    .min(4, "A VAT number has at least 4 characters")
    .max(24)
    .regex(/^[A-Za-z0-9 -]+$/, "A VAT number is letters, digits, spaces and dashes"),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/**
 * Correcting a number, closing a registration that has lapsed, or succeeding
 * one that has changed.
 *
 * The third case is why the dates are on the screen at all. A company that
 * re-registers keeps both numbers: the old one is what its invoices carried
 * until the change, and rebuilding that month has to quote it. Overwriting the
 * row would rewrite those months to say something that was never on the
 * paperwork.
 *
 * Which of the three this is comes from the dates, not from a button. Moving
 * `validFrom` forward says "a different number, from this date": the row in
 * force is closed the day before and a new one opens. Leaving `validFrom`
 * where it was says "this row, corrected". There is no way to say "a different
 * number, retroactively, and forget the old one" — that is not an edit, it is
 * a rewrite of what was filed.
 */
export async function saveSellerVatNumber(input: unknown): Promise<ActionResult> {
  return inRequest(() => saveSellerVatNumberInScope(input));
}

async function saveSellerVatNumberInScope(input: unknown): Promise<ActionResult> {
  const user = await requireEditor();
  const parsed = sellerVatSchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const { id, ...values } = parsed.data;

  const db = getDb();

  // Read first: the country and the scheme come from the stored row and never
  // from the browser, and whether this is a succession is a comparison against
  // what is there now. The tenant clause is what stops an id from another
  // company being reached through this one; row-level security stops it as
  // well, and both is the point.
  const [existing] = await db
    .select()
    .from(schema.sellerVatNumbers)
    .where(
      and(eq(schema.sellerVatNumbers.id, id), eq(schema.sellerVatNumbers.tenantId, user.tenantId)),
    )
    .limit(1);

  if (!existing) {
    return { ok: false, message: "That registration is no longer there. Reload the page." };
  }

  const succeeds = values.validFrom > existing.validFrom && values.vatNumber !== existing.vatNumber;

  if (succeeds) {
    const closesOn = dayBefore(values.validFrom);

    if (closesOn < existing.validFrom) {
      return {
        ok: false,
        message: `${existing.vatNumber} starts on ${existing.validFrom}, so a new number cannot begin the day after it starts. Pick a later date.`,
      };
    }

    // Both rows in one transaction, because a company with two open
    // registrations for the same pair is a company whose reports cannot say
    // which number is theirs — and the unique index would refuse the second
    // one anyway, leaving the first closed and nothing to replace it.
    await db.transaction(async (tx) => {
      await tx
        .update(schema.sellerVatNumbers)
        .set({ validTo: closesOn })
        .where(eq(schema.sellerVatNumbers.id, id));

      await tx.insert(schema.sellerVatNumbers).values({
        tenantId: user.tenantId,
        country: existing.country,
        scheme: existing.scheme,
        note: existing.note,
        vatNumber: values.vatNumber,
        validFrom: values.validFrom,
        validTo: values.validTo ?? null,
      });
    });

    await audit(user, "seller_vat.succeeded", "seller_vat_number", id, {
      ...values,
      replaces: existing.vatNumber,
      closedOn: closesOn,
    });
    revalidatePath("/settings");

    return {
      ok: true,
      message: `${values.vatNumber} is in force from ${values.validFrom}. ${existing.vatNumber} stays on reports up to ${closesOn}.`,
    };
  }

  await db
    .update(schema.sellerVatNumbers)
    .set({ ...values, validTo: values.validTo ?? null })
    .where(eq(schema.sellerVatNumbers.id, id));

  await audit(user, "seller_vat.updated", "seller_vat_number", id, values);
  revalidatePath("/settings");

  return { ok: true, message: `${values.vatNumber} saved.` };
}

const skuSchema = z.object({
  id: z.string().uuid().optional(),
  channel: z.string().trim().min(1),
  sourceSku: z.string().trim().min(1),
  sourceName: z.string().trim().default(""),
  targetSku: z.string().trim().nullable().optional(),
  itemName: z.string().trim().nullable().optional(),
  isIgnored: z.boolean(),
});

export async function saveSkuMapping(input: unknown): Promise<ActionResult> {
  return inRequest(() => saveSkuMappingInScope(input));
}

async function saveSkuMappingInScope(input: unknown): Promise<ActionResult> {
  const user = await requireEditor();
  const parsed = skuSchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const { id, ...values } = parsed.data;

  // Shopify writes its item code only when the product has one, and renames
  // products freely, so a mapping there is only trustworthy as a pair. The
  // channels that report no name have nothing to put here and must not be
  // made to invent one.
  if (values.channel.startsWith("shopify") && values.sourceName === "") {
    return {
      ok: false,
      message: "A Shopify mapping needs the source name the code arrives with.",
    };
  }

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
  return inRequest(() => deleteSkuMappingInScope(id));
}

async function deleteSkuMappingInScope(id: string): Promise<ActionResult> {
  const user = await requireEditor();

  await getDb()
    .delete(schema.skuMappings)
    .where(and(eq(schema.skuMappings.id, id), eq(schema.skuMappings.tenantId, user.tenantId)));

  await audit(user, "sku_mapping.deleted", "sku_mapping", id);
  revalidatePath("/settings");

  return { ok: true, message: "Entry deleted." };
}

const allegroCurrencySchema = z.object({
  currency: z
    .string()
    .trim()
    .min(1, "A currency is required")
    .max(10)
    .toUpperCase(),
  country: z.string().trim().length(2, "A country is a 2-letter code").toUpperCase(),
  scheme: z.enum(["REGULAR", "UNION-OSS"]),
});

/**
 * Adds or edits one entry of `allegro / currency_map` — the currency decides
 * the arrival country and the VAT scheme, so the two are kept together instead
 * of asking someone to hand-edit the JSON. The registration number is not one
 * of them: it belongs to the company and is edited on its own screen, then
 * looked up by the pair this map produces.
 *
 * The row is one JSON blob shared by every currency (see `channelRules` on
 * the schema), so this reads it, merges the one key that changed, and writes
 * the whole thing back — the same shape `saveChannelRule` writes, just typed
 * instead of pasted.
 */
export async function saveAllegroCurrency(input: unknown): Promise<ActionResult> {
  return inRequest(() => saveAllegroCurrencyInScope(input));
}

async function saveAllegroCurrencyInScope(input: unknown): Promise<ActionResult> {
  const user = await requireEditor();
  const parsed = allegroCurrencySchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const { currency, ...rule } = parsed.data;
  const db = getDb();

  const [existing] = await db
    .select({ id: schema.channelRules.id, value: schema.channelRules.value })
    .from(schema.channelRules)
    .where(
      and(
        eq(schema.channelRules.tenantId, user.tenantId),
        eq(schema.channelRules.channel, "allegro"),
        eq(schema.channelRules.key, "currency_map"),
      ),
    );

  const map = { ...((existing?.value as Record<string, unknown>) ?? {}), [currency]: rule };

  if (existing) {
    await db
      .update(schema.channelRules)
      .set({ value: map })
      .where(eq(schema.channelRules.id, existing.id));
  } else {
    await db.insert(schema.channelRules).values({
      tenantId: user.tenantId,
      channel: "allegro",
      key: "currency_map",
      value: map,
      note: "The currency decides the arrival country, the rate and the seller VAT number.",
    });
  }

  await audit(user, "allegro_currency.saved", "channel_rule", existing?.id, { currency, ...rule });
  revalidatePath("/settings");
  // The gate that sends someone here lives on Reports, and what it is
  // willing to build changes the moment the currency is mapped.
  revalidatePath("/reports");

  return { ok: true, message: `Currency ${currency} saved.` };
}

export async function deleteAllegroCurrency(currency: string): Promise<ActionResult> {
  return inRequest(() => deleteAllegroCurrencyInScope(currency));
}

async function deleteAllegroCurrencyInScope(currency: string): Promise<ActionResult> {
  const user = await requireEditor();
  const db = getDb();

  const [existing] = await db
    .select({ id: schema.channelRules.id, value: schema.channelRules.value })
    .from(schema.channelRules)
    .where(
      and(
        eq(schema.channelRules.tenantId, user.tenantId),
        eq(schema.channelRules.channel, "allegro"),
        eq(schema.channelRules.key, "currency_map"),
      ),
    );

  if (!existing) return { ok: false, message: "There is no currency map to remove from." };

  const map = { ...(existing.value as Record<string, unknown>) };

  delete map[currency];

  await db
    .update(schema.channelRules)
    .set({ value: map })
    .where(eq(schema.channelRules.id, existing.id));

  await audit(user, "allegro_currency.deleted", "channel_rule", existing.id, { currency });
  revalidatePath("/settings");
  revalidatePath("/reports");

  return { ok: true, message: `Currency ${currency} removed.` };
}

export async function saveChannelRule(id: string, rawValue: string): Promise<ActionResult> {
  return inRequest(() => saveChannelRuleInScope(id, rawValue));
}

async function saveChannelRuleInScope(id: string, rawValue: string): Promise<ActionResult> {
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
  return inRequest(() => refreshRatesInScope(full));
}

async function refreshRatesInScope(full = false): Promise<ActionResult> {
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
  return inRequest(() => restoreDefaultsInScope());
}

async function restoreDefaultsInScope(): Promise<ActionResult> {
  const user = await requireEditor();
  // Rates, mappings and channel defaults — never VAT registrations. Those name
  // a legal entity, so they are entered in Settings and restored by nobody:
  // seeding them is how a company ends up printing another's numbers.
  const result = await seedReferenceData(user.tenantId);
  const added = result.vatRates + result.skuMappings + result.channelRules;

  await audit(user, "reference.restored", "reference", undefined, result);
  revalidatePath("/settings");
  // The banner offering this action lives on Reports, and the availability it
  // gates changes the moment the rules are back.
  revalidatePath("/reports");

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
