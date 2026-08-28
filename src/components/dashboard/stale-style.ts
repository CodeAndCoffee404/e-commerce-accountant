import type { CSSProperties } from "react";

/**
 * The one visual answer to "is this still the old month's data": dimmed and
 * inert while a switch is in flight, snapping back the instant the new data
 * commits. Applied uniformly to every block whose content comes from the
 * server (`DashboardData`, the deadlines list) rather than from the month
 * picked locally — so a month switch reads as one consistent wait rather
 * than some parts updating early, others hanging silently, and others
 * showing their own separate spinner.
 */
export function staleStyle(switching: boolean): CSSProperties {
  return {
    opacity: switching ? 0.45 : 1,
    transition: "opacity 150ms ease",
    pointerEvents: switching ? "none" : undefined,
  };
}
