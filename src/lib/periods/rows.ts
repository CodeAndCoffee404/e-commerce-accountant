import { desc, eq } from "drizzle-orm";
import { cache } from "react";

import { getDb, schema } from "@/lib/db";
import type { PeriodGranularity } from "@/lib/db/schema";

export type PeriodRowSummary = {
  label: string;
  granularity: PeriodGranularity;
  startDate: string;
  endDate: string;
};

/**
 * Every period this company has, read once per request.
 *
 * The same list answers four questions on a single page — which months the
 * dashboard offers, which reports are available, which rows each report has,
 * what is due this month — and each asked the database for it separately. The
 * table is small and the query is cheap, but over a pooler a cheap query still
 * costs two round trips, and four of them sat one after another in front of
 * the page.
 *
 * Cached for the request only. A period opened mid-render would not be seen,
 * which is the correct answer: the screen should describe one moment, not
 * change shape halfway down.
 *
 * Ordered by when they start, never by their label: '2026.Y' and '2026.Q3'
 * sort before '2026.07 July' as text, which would interleave a year with the
 * months inside it.
 */
export const periodsOf = cache(async function periodsOf(
  tenantId: string,
): Promise<PeriodRowSummary[]> {
  return getDb()
    .select({
      label: schema.periods.label,
      granularity: schema.periods.granularity,
      startDate: schema.periods.startDate,
      endDate: schema.periods.endDate,
    })
    .from(schema.periods)
    .where(eq(schema.periods.tenantId, tenantId))
    .orderBy(desc(schema.periods.startDate));
});
