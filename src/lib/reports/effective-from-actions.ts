"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import type { MembershipRole } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

import { loadPeriodConfiguration, ensurePeriodFor } from "@/lib/periods/ensure";
import { nextPeriod, periodContaining } from "@/lib/periods/calendar";

import { reportDefinition } from "./definitions";
import {
  previewEffectiveFromChange,
  validateEffectiveFrom,
  type EffectiveFromPreview,
} from "./effective-from";
import { loadReportSettings } from "./queries";
import { preparedGranularities } from "./settings";

/**
 * Who is allowed to move a report's reporting-start date.
 *
 * Wider than the rest of report configuration (owner-only): the accountant
 * is the person who actually knows when a client started filing a given
 * report, and making this owner-only would just mean the owner relays a
 * date they were told by someone else.
 */
const EDITOR_ROLES: readonly MembershipRole[] = ["owner", "accountant"];

const inputSchema = z.object({
  reportType: z.string(),
  effectiveFrom: z.string(),
});

export type EffectiveFromActionResult =
  | { ok: true; committed: false; preview: EffectiveFromPreview }
  | { ok: true; committed: true; message: string }
  | { ok: false; message: string };

async function resolvePreview(
  tenantId: string,
  reportType: string,
  effectiveFrom: string,
): Promise<
  | { ok: true; preview: EffectiveFromPreview; granularities: ReturnType<typeof preparedGranularities>; currentEffectiveFrom: string | null }
  | { ok: false; message: string }
> {
  let definition;

  try {
    definition = reportDefinition(reportType as Parameters<typeof reportDefinition>[0]);
  } catch {
    return { ok: false, message: `Unknown report type: ${reportType}.` };
  }

  const today = new Date().toISOString().slice(0, 10);
  const validationError = validateEffectiveFrom(effectiveFrom, today);

  if (validationError) return { ok: false, message: validationError };

  const [settings, { schedule }, periods] = await Promise.all([
    loadReportSettings(tenantId),
    loadPeriodConfiguration(tenantId),
    getDb()
      .select({
        label: schema.periods.label,
        granularity: schema.periods.granularity,
        start: schema.periods.startDate,
      })
      .from(schema.periods)
      .where(eq(schema.periods.tenantId, tenantId)),
  ]);

  const configured = settings[reportType as keyof typeof settings];
  const granularities = preparedGranularities(definition, configured);

  if (granularities.length === 0) {
    return { ok: false, message: `"${definition.label}" is not prepared for any period.` };
  }

  const preview = previewEffectiveFromChange(
    granularities,
    effectiveFrom,
    today,
    schedule,
    periods,
    configured.effectiveFrom,
  );

  return { ok: true, preview, granularities, currentEffectiveFrom: configured.effectiveFrom };
}

/**
 * What would happen if this report's reporting-start date moved to
 * `effectiveFrom` — the numbers an admin sees before they can confirm
 * anything. Writes nothing.
 */
export async function previewEffectiveFrom(
  raw: z.input<typeof inputSchema>,
): Promise<EffectiveFromActionResult> {
  const user = await requireUser();

  if (!EDITOR_ROLES.includes(user.role)) {
    return { ok: false, message: "Only the owner or an accountant can change this." };
  }

  const input = inputSchema.parse(raw);
  const resolved = await resolvePreview(user.tenantId, input.reportType, input.effectiveFrom);

  if (!resolved.ok) return resolved;

  return { ok: true, committed: false, preview: resolved.preview };
}

/**
 * Moves a report's reporting-start date, having the admin confirm the exact
 * periods this opens and the exact periods it hides first.
 *
 * Opening periods and hiding periods are different operations done for
 * different reasons, and only one of them touches the database: `willCreate`
 * periods are inserted (idempotently — the same call twice does no harm);
 * `willHide` periods, and every upload inside them, are left completely
 * alone. Only the stored `effectiveFrom` changes, and `availablePeriods`
 * reads it at request time to decide what this report currently offers.
 */
export async function saveEffectiveFrom(
  raw: z.input<typeof inputSchema>,
): Promise<EffectiveFromActionResult> {
  const user = await requireUser();

  if (!EDITOR_ROLES.includes(user.role)) {
    return { ok: false, message: "Only the owner or an accountant can change this." };
  }

  const input = inputSchema.parse(raw);
  const resolved = await resolvePreview(user.tenantId, input.reportType, input.effectiveFrom);

  if (!resolved.ok) return resolved;

  const { schedule } = await loadPeriodConfiguration(user.tenantId);
  const db = getDb();

  await db.transaction(async (tx) => {
    for (const granularity of resolved.granularities) {
      let period = periodContaining(granularity, input.effectiveFrom, schedule);
      const today = new Date().toISOString().slice(0, 10);
      let steps = 0;

      // Re-walks the same ground previewEffectiveFromChange already walked,
      // rather than trusting its `willCreate` summary: the summary is for
      // display, this is the write, and the unique index makes re-creating
      // an already-open period free.
      while (period.start <= today && steps < 240) {
        await ensurePeriodFor(user.tenantId, period, tx);

        period = nextPeriod(granularity, period, schedule);
        steps += 1;
      }
    }

    const [existingRow] = await tx
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

    const value = {
      ...((existingRow?.value as Record<string, unknown>) ?? {}),
      effectiveFrom: input.effectiveFrom,
    };

    await tx
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
  });

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    {
      action: "report.effective_from_changed",
      entity: "report_settings",
      entityId: input.reportType,
      payload: {
        effectiveFrom: input.effectiveFrom,
        previousEffectiveFrom: resolved.currentEffectiveFrom,
        opened: resolved.preview.willCreate,
        hidden: resolved.preview.willHide,
      },
    },
  );

  revalidatePath("/reports");
  revalidatePath("/settings");
  revalidatePath("/dashboard");

  const definition = reportDefinition(input.reportType as Parameters<typeof reportDefinition>[0]);
  const openedCount = resolved.preview.willCreate.reduce((sum, entry) => sum + entry.count, 0);

  return {
    ok: true,
    committed: true,
    message:
      openedCount === 0
        ? `${definition.label} now starts from ${input.effectiveFrom}.`
        : `${definition.label} now starts from ${input.effectiveFrom}. ${openedCount} period${openedCount === 1 ? "" : "s"} opened.`,
  };
}
