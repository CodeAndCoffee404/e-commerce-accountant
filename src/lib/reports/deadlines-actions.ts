"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { can, inRequest, requireAccess } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";

import { reportDefinition } from "./definitions";
import { loadReportSettings } from "./queries";
import { preparedGranularities } from "./settings";

export type DeadlineActionResult = { ok: boolean; message: string };

const inputSchema = z.object({
  reportType: z.enum([
    "sales_by_currency",
    "off_amazon_sales",
    "amazon_zoho_invoice",
    "allegro_zoho_invoice",
    "shopify_zoho_invoice",
  ]),
  granularity: z.enum(["month", "quarter", "year"]),
  day: z.number().int().min(1).max(31),
  /** Required for yearly reports, ignored for the rest. */
  month: z.number().int().min(1).max(12).nullable(),
});

export type SaveDeadlineRuleInput = z.input<typeof inputSchema>;

/**
 * Stores one report's deadline rule. Owner and accountant both file, so both
 * may set when a report is due — unlike the rest of Settings → Reports, which
 * is the owner's alone.
 *
 * Nothing is recalculated here: no date is ever stored per period, only the
 * rule. Every period's deadline is computed from it at read time, which is
 * what makes editing the rule retroactive for free — see PLAN §3.
 */
export async function saveDeadlineRule(
  raw: SaveDeadlineRuleInput,
): Promise<DeadlineActionResult> {
  return inRequest(() => saveDeadlineRuleInScope(raw));
}

async function saveDeadlineRuleInScope(
  raw: SaveDeadlineRuleInput,
): Promise<DeadlineActionResult> {
  const user = await requireAccess();

  if (!can(user, "settings_deadlines", "edit")) {
    return { ok: false, message: "Your role cannot change report deadlines." };
  }

  const input = inputSchema.parse(raw);
  const definition = reportDefinition(input.reportType);

  if (definition.informational) {
    return { ok: false, message: `"${definition.label}" is never filed and has no deadline.` };
  }

  if (!definition.granularity.includes(input.granularity)) {
    return { ok: false, message: `"${definition.label}" is not built per ${input.granularity}.` };
  }

  const settings = await loadReportSettings(user.tenantId);
  const configured = settings[input.reportType];

  if (!configured.enabled) {
    return { ok: false, message: `"${definition.label}" is off and has no deadline to set.` };
  }

  if (!preparedGranularities(definition, configured).includes(input.granularity)) {
    return {
      ok: false,
      message: `"${definition.label}" is not prepared per ${input.granularity} for this tenant.`,
    };
  }

  if (input.granularity === "year" && input.month === null) {
    return { ok: false, message: "A yearly deadline needs a month as well as a day." };
  }

  const deadlineMonth = input.granularity === "year" ? input.month : null;

  await getDb()
    .insert(schema.reportDeadlines)
    .values({
      tenantId: user.tenantId,
      reportType: input.reportType,
      granularity: input.granularity,
      deadlineDay: input.day,
      deadlineMonth,
      updatedBy: user.id,
    })
    .onConflictDoUpdate({
      target: [
        schema.reportDeadlines.tenantId,
        schema.reportDeadlines.reportType,
        schema.reportDeadlines.granularity,
      ],
      set: { deadlineDay: input.day, deadlineMonth, updatedAt: new Date(), updatedBy: user.id },
    });

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    {
      action: "report.deadline_changed",
      entity: "report_deadline",
      entityId: `${input.reportType}:${input.granularity}`,
      payload: { day: input.day, month: deadlineMonth },
    },
  );

  revalidatePath("/dashboard");
  revalidatePath("/settings");

  return { ok: true, message: `${definition.label} (${input.granularity}) deadline updated.` };
}
