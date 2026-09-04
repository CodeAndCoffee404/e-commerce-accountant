"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { can, inRequest, requireAccess } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";

import { ensurePeriods } from "./ensure";
import { PERIODS_CHANNEL, SCHEDULE_KEY, normaliseSchedule } from "./schedule";

export type PeriodActionResult = { ok: boolean; message: string };

const inputSchema = z.object({
  month: z.boolean(),
  quarter: z.boolean(),
  year: z.boolean(),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
});

export type SavePeriodScheduleInput = z.input<typeof inputSchema>;

/**
 * Which periods this tenant opens, and when their year begins.
 *
 * Stored as one row in channel_rules under the "periods" channel, the same way
 * report configuration is stored under "reports". Saving takes effect at once
 * rather than at the next scheduled run: a granularity switched on that then
 * showed nothing until the small hours would read as a broken switch.
 *
 * Turning one on never reaches backwards. It starts from the period being
 * lived through — switch quarterly filing on in the middle of Q3 and Q3
 * appears, because that is the quarter being worked on — and the ones before
 * it stay absent unless a file arrives for them.
 */
export async function savePeriodSchedule(
  raw: SavePeriodScheduleInput,
): Promise<PeriodActionResult> {
  return inRequest(() => savePeriodScheduleInScope(raw));
}

async function savePeriodScheduleInScope(
  raw: SavePeriodScheduleInput,
): Promise<PeriodActionResult> {
  const user = await requireAccess();

  if (!can(user, "settings_company", "edit")) {
    return { ok: false, message: "Your role cannot change the period schedule." };
  }

  const parsed = inputSchema.safeParse(raw);

  if (!parsed.success) {
    return { ok: false, message: "That is not a schedule this can store." };
  }

  const value = normaliseSchedule(parsed.data);

  if (!value.month && !value.quarter && !value.year) {
    return {
      ok: false,
      message:
        "At least one period has to be opened. With none, nothing would ever appear to file — " +
        "turn a report off under Reports instead if that is what is meant.",
    };
  }

  await getDb()
    .insert(schema.channelRules)
    .values({
      tenantId: user.tenantId,
      channel: PERIODS_CHANNEL,
      key: SCHEDULE_KEY,
      value,
      note: "Which periods are opened, and when the financial year begins.",
    })
    .onConflictDoUpdate({
      target: [schema.channelRules.tenantId, schema.channelRules.channel, schema.channelRules.key],
      set: { value },
    });

  // Immediately, not at the next run of the scheduler.
  const opened = await ensurePeriods(user.tenantId, new Date().toISOString().slice(0, 10));

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    {
      action: "period.schedule_changed",
      entity: "period_schedule",
      payload: { ...value, opened: opened.map((period) => period.label) },
    },
  );

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/source-files");

  if (opened.length === 0) return { ok: true, message: "Schedule saved." };

  return {
    ok: true,
    message:
      opened.length === 1
        ? `Schedule saved. ${opened[0].label} is now open.`
        : `Schedule saved. ${opened.length} periods are now open.`,
  };
}
