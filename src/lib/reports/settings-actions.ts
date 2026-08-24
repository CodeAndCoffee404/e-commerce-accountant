"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";

import { reportDefinition } from "./definitions";
import type { Requirement } from "./settings";
import { ZOHO_COUNTRIES } from "@/modules/reports/amazon-zoho-invoice";

export type SettingsActionResult = { ok: boolean; message: string };

const inputSchema = z.object({
  reportType: z.enum(["sales_by_currency", "off_amazon_sales", "amazon_zoho_invoice"]),
  enabled: z.boolean(),
  /** Datasets demoted to optional; everything else stays required. */
  optionalDatasets: z.array(z.string()).default([]),
  /** Zoho marketplaces demoted to optional. */
  optionalCountries: z.array(z.string()).default([]),
  /**
   * Periods this report is not prepared for. Only deviations are sent, so a
   * report gains a new granularity switched on rather than off.
   */
  disabledGranularities: z.array(z.string()).default([]),
});

export type SaveReportSettingsInput = z.input<typeof inputSchema>;

/**
 * Stores one report's configuration as a row in channel_rules under the
 * "reports" channel. Only deviations are written — an absent entry means
 * required — so the stored value stays readable in the rules editor and a
 * report added later starts strict.
 */
export async function saveReportSettings(
  raw: SaveReportSettingsInput,
): Promise<SettingsActionResult> {
  const user = await requireUser();

  if (user.role !== "owner") {
    return { ok: false, message: "Only the owner can change report settings." };
  }

  const input = inputSchema.parse(raw);
  const definition = reportDefinition(input.reportType);

  const unknownDataset = input.optionalDatasets.find(
    (dataset) => !(definition.datasets as readonly string[]).includes(dataset),
  );

  if (unknownDataset) {
    return { ok: false, message: `"${definition.label}" does not read ${unknownDataset}.` };
  }

  const unknownCountry = input.optionalCountries.find(
    (country) => !(ZOHO_COUNTRIES as readonly string[]).includes(country),
  );

  if (unknownCountry) {
    return { ok: false, message: `${unknownCountry} is not one of the ten marketplaces.` };
  }

  const datasets: Record<string, Requirement> = {};

  for (const dataset of input.optionalDatasets) datasets[dataset] = "optional";

  const countries: Record<string, Requirement> = {};

  for (const country of input.optionalCountries) countries[country] = "optional";

  const unknownGranularity = input.disabledGranularities.find(
    (granularity) => !(definition.granularity as readonly string[]).includes(granularity),
  );

  if (unknownGranularity) {
    return {
      ok: false,
      message: `"${definition.label}" is not built per ${unknownGranularity}.`,
    };
  }

  const granularities: Record<string, boolean> = {};

  for (const granularity of input.disabledGranularities) granularities[granularity] = false;

  const value = { enabled: input.enabled, datasets, countries, granularities };

  await getDb()
    .insert(schema.channelRules)
    .values({
      tenantId: user.tenantId,
      channel: "reports",
      key: input.reportType,
      value,
      note: "Report configuration — edited on Settings -> Reports.",
    })
    .onConflictDoUpdate({
      target: [schema.channelRules.tenantId, schema.channelRules.channel, schema.channelRules.key],
      set: { value },
    });

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    {
      action: "report.settings_changed",
      entity: "report_settings",
      entityId: input.reportType,
      payload: value,
    },
  );

  revalidatePath("/reports");
  revalidatePath("/settings");

  return {
    ok: true,
    message: input.enabled
      ? `${definition.label} updated.`
      : `${definition.label} is now off. It disappears from Reports until turned back on.`,
  };
}

const startDateSchema = z.object({
  reportType: z.enum(["sales_by_currency", "off_amazon_sales", "amazon_zoho_invoice"]),
  /** The first of a month, or null to lift the floor entirely. */
  startsFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/, "Pick a month.")
    .nullable(),
});

export type SaveReportStartDateInput = z.input<typeof startDateSchema>;

/**
 * Kept apart from `saveReportSettings` on purpose: this one decides which
 * periods a report is willing to be built for and shown for at all, which is
 * a far easier switch to flip by accident than "optional" or a granularity
 * toggle — the interface asks for a second confirmation before calling it.
 */
export async function saveReportStartDate(
  raw: SaveReportStartDateInput,
): Promise<SettingsActionResult> {
  const user = await requireUser();

  if (user.role !== "owner") {
    return { ok: false, message: "Only the owner can change report settings." };
  }

  const input = startDateSchema.parse(raw);
  const definition = reportDefinition(input.reportType);
  const db = getDb();

  const [existing] = await db
    .select({ value: schema.channelRules.value })
    .from(schema.channelRules)
    .where(
      and(
        eq(schema.channelRules.tenantId, user.tenantId),
        eq(schema.channelRules.channel, "reports"),
        eq(schema.channelRules.key, input.reportType),
      ),
    )
    .limit(1);

  const base = (existing?.value ?? {}) as Record<string, unknown>;
  const value = { ...base, startsFrom: input.startsFrom };

  await db
    .insert(schema.channelRules)
    .values({
      tenantId: user.tenantId,
      channel: "reports",
      key: input.reportType,
      value,
      note: "Report configuration — edited on Settings -> Reports.",
    })
    .onConflictDoUpdate({
      target: [schema.channelRules.tenantId, schema.channelRules.channel, schema.channelRules.key],
      set: { value },
    });

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    {
      action: "report.start_date_changed",
      entity: "report_settings",
      entityId: input.reportType,
      payload: { startsFrom: input.startsFrom },
    },
  );

  revalidatePath("/reports");
  revalidatePath("/dashboard");
  revalidatePath("/settings");

  return {
    ok: true,
    message: input.startsFrom
      ? `${definition.label} now starts from ${input.startsFrom.slice(0, 7)}. Earlier periods no longer offer it.`
      : `${definition.label} has no start date — every period it can build for is offered again.`,
  };
}
