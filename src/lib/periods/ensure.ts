import { and, eq } from "drizzle-orm";

import { getDb, schema, type Executor } from "@/lib/db";
import type { PeriodRow } from "@/lib/db/schema";
import type { Period } from "@/lib/ingest/period";

import { anchorFor, periodsDue } from "./calendar";
import {
  ANCHOR_KEY,
  PERIODS_CHANNEL,
  SCHEDULE_KEY,
  enabledGranularities,
  normaliseAnchors,
  normaliseSchedule,
  type PeriodAnchors,
  type PeriodSchedule,
} from "./schedule";

export type PeriodConfiguration = { schedule: PeriodSchedule; anchors: PeriodAnchors };

/**
 * This tenant's schedule and where each granularity started, read in one go.
 *
 * Both live in channel_rules under the "periods" channel, next to the report
 * configuration under "reports" — the client's own description of how their
 * filing works, kept as data rather than as schema.
 */
export async function loadPeriodConfiguration(
  tenantId: string,
  db: Executor = getDb(),
): Promise<PeriodConfiguration> {
  const rows = await db
    .select({ key: schema.channelRules.key, value: schema.channelRules.value })
    .from(schema.channelRules)
    .where(
      and(
        eq(schema.channelRules.tenantId, tenantId),
        eq(schema.channelRules.channel, PERIODS_CHANNEL),
      ),
    );

  const stored = new Map(rows.map((row) => [row.key, row.value]));

  return {
    schedule: normaliseSchedule(stored.get(SCHEDULE_KEY)),
    anchors: normaliseAnchors(stored.get(ANCHOR_KEY)),
  };
}

/**
 * Opens every period that should exist by `asOf`, and no others.
 *
 * Safe to call as often as anything likes: the unique index on
 * (tenant_id, label) turns a second call into no work at all, so a scheduler
 * catching up on a missed day and one that fired on time are the same
 * operation. That is what lets this be called from a page load as well as
 * from the cron — the schedule stops being the only thing standing between a
 * new month and its checklist.
 *
 * `asOf` is an argument rather than a reading of the clock so that the
 * behaviour on the first of the month can be tested on any other day.
 */
export async function ensurePeriods(
  tenantId: string,
  asOf: string,
  db: Executor = getDb(),
): Promise<PeriodRow[]> {
  const { schedule, anchors } = await loadPeriodConfiguration(tenantId, db);
  const resolved: PeriodAnchors = { ...anchors };
  let anchored = false;

  // A granularity that has just been turned on starts here and now. Without
  // this the first run would have nothing to walk forward from and would open
  // nothing at all, which reads exactly like a broken scheduler.
  for (const granularity of enabledGranularities(schedule)) {
    if (resolved[granularity]) continue;

    resolved[granularity] = anchorFor(granularity, asOf, schedule);
    anchored = true;
  }

  if (anchored) {
    await db
      .insert(schema.channelRules)
      .values({
        tenantId,
        channel: PERIODS_CHANNEL,
        key: ANCHOR_KEY,
        value: resolved,
        note: "Where each granularity started being scheduled. Periods are never opened before it.",
      })
      .onConflictDoUpdate({
        target: [
          schema.channelRules.tenantId,
          schema.channelRules.channel,
          schema.channelRules.key,
        ],
        set: { value: resolved },
      });
  }

  const due = periodsDue(resolved, asOf, schedule);

  if (due.length === 0) return [];

  return db
    .insert(schema.periods)
    .values(
      due.map((period) => ({
        tenantId,
        label: period.label,
        granularity: period.granularity,
        startDate: period.start,
        endDate: period.end,
        origin: "schedule" as const,
      })),
    )
    .onConflictDoNothing({ target: [schema.periods.tenantId, schema.periods.label] })
    .returning();
}

/**
 * The period a file belongs to, opened if it is not there yet.
 *
 * A file for a month nobody scheduled — an export arriving long after the
 * fact, or one for a granularity this tenant does not open — is never
 * refused. Refusing it would push the correction outside the system, where
 * nothing traces it; the period is opened instead, marked as having come from
 * an upload rather than from the calendar.
 */
export async function ensurePeriodFor(
  tenantId: string,
  period: Period,
  db: Executor = getDb(),
): Promise<string> {
  const [inserted] = await db
    .insert(schema.periods)
    .values({
      tenantId,
      label: period.label,
      granularity: period.granularity,
      startDate: period.start,
      endDate: period.end,
      origin: "upload",
    })
    .onConflictDoNothing({ target: [schema.periods.tenantId, schema.periods.label] })
    .returning({ id: schema.periods.id });

  if (inserted) return inserted.id;

  // The conflict means it already exists — which is the ordinary case, since
  // most files arrive for a period the calendar opened weeks ago.
  const [existing] = await db
    .select({ id: schema.periods.id })
    .from(schema.periods)
    .where(and(eq(schema.periods.tenantId, tenantId), eq(schema.periods.label, period.label)))
    .limit(1);

  if (!existing) {
    throw new Error(`Period ${period.label} could neither be created nor found.`);
  }

  return existing.id;
}
