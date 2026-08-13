import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { databaseUrl } from "@/lib/env";

import * as schema from "./schema";

declare global {
  var __eaSql: ReturnType<typeof postgres> | undefined;
}

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * postgres-js over a plain TCP connection rather than the Neon HTTP driver:
 * the HTTP driver cannot do multi-statement transactions, and superseding a
 * period's transactions has to be atomic.
 *
 * `max: 1` because serverless functions each hold their own connection; the
 * pooling belongs to Neon's pooler endpoint, not to the process.
 */
function createClient() {
  return postgres(databaseUrl(), {
    max: 1,
    idle_timeout: 20,
    prepare: false,
  });
}

let instance: Database | undefined;

/**
 * A function rather than an exported instance: reading `databaseUrl()` at
 * import time makes every module that merely mentions the database fail
 * without one — `next build` imports without a runtime environment, and unit
 * tests over pure functions would need a connection string to run.
 *
 * Deliberately not a lazy Proxy either. The Drizzle adapter identifies the
 * database with an `instanceof` check, and a proxy fails it.
 */
export function getDb(): Database {
  if (instance) return instance;

  // Reuse across hot reloads in development so we do not exhaust connections.
  const client = globalThis.__eaSql ?? createClient();

  if (process.env.NODE_ENV !== "production") globalThis.__eaSql = client;

  instance = drizzle(client, { schema });
  return instance;
}

export { schema };
