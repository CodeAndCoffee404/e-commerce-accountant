import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getDb, schema } from "@/lib/db";
import { cronSecret } from "@/lib/env";
import { log } from "@/lib/log";
import { ensurePeriods } from "@/lib/periods/ensure";

/**
 * The one scheduled job this application gets.
 *
 * Vercel's plan here allows a single cron, so this is deliberately a daily
 * maintenance route rather than a period-opening one: anything else that needs
 * to happen on a schedule later — refreshing reference rates, say — belongs in
 * this handler beside the work below, because there is no second slot to put
 * it in.
 *
 * Daily rather than monthly, though periods only ever open on the first.
 * A monthly schedule gets twelve attempts a year, and the one that matters
 * fails if a deployment happens to be mid-flight or the database is slow to
 * wake — and the next attempt is a month later, by which time the month has
 * been missing from the dashboard the whole time. Running every day makes
 * `ensurePeriods` catch up the following morning instead, at the cost of
 * thirty queries a month that find nothing to do.
 */

/** Postgres and the driver both need Node; the edge runtime cannot host this. */
export const runtime = "nodejs";

function authorised(request: Request): boolean {
  const secret = cronSecret();

  // Fail closed. A missing secret is a misconfiguration, and the wrong way to
  // handle it is to let anyone on the internet write rows.
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const offered = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);

  // Same length first: timingSafeEqual throws on a mismatch, and the length
  // of a bearer token is not the part worth hiding.
  return offered.length === expected.length && timingSafeEqual(offered, expected);
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!authorised(request)) {
    log.warn("cron.unauthorised", {});

    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  // The scheduler's own day, in UTC. Vercel fires within the hour it is given,
  // and the hour chosen in vercel.json sits far enough from midnight that the
  // date is never in question wherever the client is.
  const today = new Date().toISOString().slice(0, 10);

  const tenants = await getDb()
    .select({ id: schema.tenants.id, name: schema.tenants.name })
    .from(schema.tenants);

  const opened: { tenant: string; periods: string[] }[] = [];
  const failed: { tenant: string; error: string }[] = [];

  for (const tenant of tenants) {
    try {
      const periods = await ensurePeriods(tenant.id, today);

      if (periods.length > 0) {
        opened.push({ tenant: tenant.name, periods: periods.map((period) => period.label) });

        log.info("period.opened", {
          tenantId: tenant.id,
          periods: periods.map((period) => period.label),
        });
      }
    } catch (error) {
      // One tenant's failure is not the others'. The loop continues so that a
      // single bad configuration cannot stop every other tenant's month from
      // opening, and the failure is reported rather than swallowed.
      failed.push({
        tenant: tenant.name,
        error: error instanceof Error ? error.message : "unknown error",
      });

      log.error("cron.tenant_failed", error, { tenantId: tenant.id });
    }
  }

  return NextResponse.json(
    { date: today, tenants: tenants.length, opened, failed },
    // A partial failure answers 500 so it shows up as a failed run in the
    // dashboard rather than as a success nobody reads the body of.
    { status: failed.length > 0 ? 500 : 200 },
  );
}
