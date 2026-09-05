import type { CloseReport } from "@/lib/dashboard/queries";
import { reportKey } from "@/lib/reports/target";

/**
 * How many of a month's reports are built, counted the moment each one
 * finishes rather than when the whole run does.
 *
 * The page's own answer changes only when the refresh lands, and the refresh
 * happens once, after the last build in the queue — so pressing "build all"
 * on five reports moved the meter from 0 to 5 in a single jump, with nothing
 * to show for the minutes in between. The second argument is what the build
 * queue has finished since the page was drawn: adding it counts each report
 * as it lands.
 *
 * Adding, not summing, is the point. The queue's set and the server's answer
 * overlap for as long as it takes the refresh to commit — the report is built
 * according to both — so a report is counted once whichever of them knows
 * about it, and the number never goes backwards when the queue drops its set.
 */
export function reportsBuilt(
  reports: readonly CloseReport[],
  month: string | null,
  completed: ReadonlySet<string>,
): number {
  return reports.filter((report) => {
    // Stale means built before a re-upload, which is a report to build again
    // rather than one that is done — unless this queue has just done it.
    if (report.state === "built" && !report.stale) return true;

    return month !== null && completed.has(reportKey(report.id, month));
  }).length;
}
