/**
 * Structured logging.
 *
 * One JSON object per line, because that is what Vercel's log viewer can filter
 * on. A sentence in prose reads well in a terminal and is useless when the
 * question is "show me every failed report for this tenant last Tuesday".
 *
 * Never log personal data. The exports carry buyer names, addresses and phone
 * numbers, and logs are the one place that data has no business reaching — they
 * are kept longer than anything else and read by more people. Identifiers only:
 * a tenant id, a user id, a file id. An email is a person, so it stays out.
 */

export type LogContext = {
  tenantId?: string;
  userId?: string | null;
  /** What the operation acted on: a file id, a run id. Never a filename. */
  entityId?: string;
  [key: string]: unknown;
};

type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, context: LogContext): void {
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...context,
  });

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, context: LogContext = {}) => emit("info", event, context),
  warn: (event: string, context: LogContext = {}) => emit("warn", event, context),

  /**
   * `error` is unwrapped rather than passed through JSON.stringify, which turns
   * an Error into `{}` and loses the only part worth having.
   */
  error: (event: string, error: unknown, context: LogContext = {}) =>
    emit("error", event, {
      ...context,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split("\n").slice(0, 6).join(" | ") : undefined,
    }),
};
