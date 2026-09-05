import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema, type Executor } from "@/lib/db";
import type { PeriodRow } from "@/lib/db/schema";
import type { Period } from "@/lib/ingest/period";
import { REPORT_DEFINITIONS } from "@/lib/reports/definitions";
import { normaliseSettings } from "@/lib/reports/settings";

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

/** The "reports" channel, where each report's own configuration is kept. */
const REPORTS_CHANNEL = "reports";

export type PeriodConfiguration = {
  schedule: PeriodSchedule;
  anchors: PeriodAnchors;
  /** Each enabled report's stored settings, by report id. */
  reports: Map<string, unknown>;
};

/**
 * The first month any enabled report is willing to be built for, or null when
 * none names one.
 *
 * A report with no start date is not evidence of anything: it means "every
 * period the module can build for", which says nothing about how far back this
 * company's books go. Only an explicit date does.
 */
function earliestReportStart(stored: Map<string, unknown>): string | null {
  const dates = REPORT_DEFINITIONS.map((definition) =>
    normaliseSettings(definition, stored.get(definition.id)),
  )
    .filter((report) => report.enabled && report.startsFrom)
    .map((report) => report.startsFrom as string);

  return dates.length === 0 ? null : dates.reduce((a, b) => (a < b ? a : b));
}

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
  // Both channels in one read. The report settings are wanted here for one
  // thing only — the earliest month this company files for, which is where its
  // periods have to start — and a second round trip for one date on every
  // dashboard load is not worth it.
  const rows = await db
    .select({
      channel: schema.channelRules.channel,
      key: schema.channelRules.key,
      value: schema.channelRules.value,
    })
    .from(schema.channelRules)
    .where(
      and(
        eq(schema.channelRules.tenantId, tenantId),
        inArray(schema.channelRules.channel, [PERIODS_CHANNEL, REPORTS_CHANNEL]),
      ),
    );

  const stored = new Map(
    rows.filter((row) => row.channel === PERIODS_CHANNEL).map((row) => [row.key, row.value]),
  );
  const reports = new Map(
    rows.filter((row) => row.channel === REPORTS_CHANNEL).map((row) => [row.key, row.value]),
  );

  return {
    schedule: normaliseSchedule(stored.get(SCHEDULE_KEY)),
    anchors: normaliseAnchors(stored.get(ANCHOR_KEY)),
    reports,
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
  const { schedule, anchors, reports } = await loadPeriodConfiguration(tenantId, db);
  const resolved: PeriodAnchors = { ...anchors };
  let anchored = false;

  // The earliest month this company actually files for.
  //
  // Without it a company created today anchors at today and opens one period:
  // the month we are standing in. Somebody who has just set their reports to
  // begin in June then finds a dashboard offering September and no way to
  // reach June, July or August — the months they configured the reports for
  // in the first place. The anchor means "periods are never opened before
  // this", and a report that has to be filed from June says periods are
  // needed from June.
  const earliest = earliestReportStart(reports);

  for (const granularity of enabledGranularities(schedule)) {
    const from = earliest ?? asOf;
    const wanted = anchorFor(granularity, from, schedule);
    const current = resolved[granularity];

    // Moved back, never forward. A report given a later start date narrows
    // what it is willing to show, which is its own business; it must not
    // close periods this company has already been working in.
    if (current && current <= wanted) continue;

    resolved[granularity] = wanted;
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
