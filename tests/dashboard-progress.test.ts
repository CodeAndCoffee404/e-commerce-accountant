import { describe, expect, it } from "vitest";

import { reportsBuilt } from "@/lib/dashboard/progress";
import type { CloseReport } from "@/lib/dashboard/queries";
import type { ReportTypeId } from "@/lib/reports/definitions";
import { reportKey } from "@/lib/reports/target";

/**
 * The dashboard's "Reports built" meter during a run.
 *
 * The count used to be the server's alone, and the server is only asked again
 * once the whole queue has finished — so a build of five reports left the
 * meter on its starting number for the length of five builds and then moved
 * five at once. It now adds what the build queue has finished since the page
 * was drawn, which is the same set of reports the server will report a moment
 * later; the two overlap for the length of a refresh, so what matters is that
 * the count never counts one report twice and never falls back.
 */

const MONTH = "2026-05";

function report(id: ReportTypeId, state: CloseReport["state"], stale = false): CloseReport {
  return {
    id,
    label: id,
    state,
    missing: [],
    lastFailure: null,
    warnings: 0,
    builtAt: state === "built" ? new Date() : null,
    stale,
    artifact: null,
    runId: null,
    drive: { synced: 0, failed: 0, pending: 0, total: 0 },
  };
}

const keys = (...ids: ReportTypeId[]) => new Set(ids.map((id) => reportKey(id, MONTH)));

describe("the dashboard's built count", () => {
  const month = [
    report("amazon_zoho_invoice", "ready"),
    report("allegro_zoho_invoice", "ready"),
    report("shopify_zoho_invoice", "ready"),
  ];

  it("is what the page says while nothing has been built here", () => {
    expect(reportsBuilt(month, MONTH, new Set())).toBe(0);
  });

  it("counts a report the moment the queue finishes it", () => {
    // The page still calls all three ready — the refresh has not happened and
    // will not until the queue is empty. This is the whole point: one build
    // finished is one report built.
    expect(reportsBuilt(month, MONTH, keys("amazon_zoho_invoice"))).toBe(1);
    expect(reportsBuilt(month, MONTH, keys("amazon_zoho_invoice", "allegro_zoho_invoice"))).toBe(2);
  });

  it("does not count a report twice once the page has caught up", () => {
    // The refreshed page and the queue both know about this one. The queue
    // drops its set at that same commit, and either way the answer is one.
    const refreshed = [report("amazon_zoho_invoice", "built"), month[1], month[2]];

    expect(reportsBuilt(refreshed, MONTH, keys("amazon_zoho_invoice"))).toBe(1);
    expect(reportsBuilt(refreshed, MONTH, new Set())).toBe(1);
  });

  it("counts a stale report only once this run has rebuilt it", () => {
    // Built before a re-upload: a workbook that exists and a report still to
    // build, which is why the meter does not count it until it is built again.
    const stale = [report("amazon_zoho_invoice", "built", true), month[1], month[2]];

    expect(reportsBuilt(stale, MONTH, new Set())).toBe(0);
    expect(reportsBuilt(stale, MONTH, keys("amazon_zoho_invoice"))).toBe(1);
  });

  it("ignores builds finished in another month", () => {
    // The month can be switched while a queue is running, and a report built
    // for May is not a report built for June.
    const elsewhere = new Set([reportKey("amazon_zoho_invoice", "2026-04")]);

    expect(reportsBuilt(month, MONTH, elsewhere)).toBe(0);
  });

  it("counts nothing when no month is shown", () => {
    expect(reportsBuilt(month, null, keys("amazon_zoho_invoice"))).toBe(0);
  });
});
