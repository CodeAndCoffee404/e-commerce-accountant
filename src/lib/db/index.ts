import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { databaseUrl } from "@/lib/env";

import * as schema from "./schema";
import { currentExecutor } from "./tenant";

declare global {
  var __eaSql: ReturnType<typeof postgres> | undefined;
}

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * A transaction handle, as drizzle hands it to the callback. Named here rather
 * than re-derived in each module that takes one, so "something that can run a
 * query" has a single spelling.
 */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Either of the two — for helpers that work inside a transaction or without. */
export type Executor = Database | Transaction;

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
  // A scope may say where its queries run — a transaction that has already
  // named the company to Postgres. Preferring it here is what keeps that
  // change out of the thirty other files that call this function.
  //
  // The cast is the one place this module is less than honest: a transaction
  // handle carries every query method a `Database` does and differs only by
  // `$client`, which nothing in this application reads.
  const scoped = currentExecutor();

  if (scoped) return scoped as Database;

  if (instance) return instance;

  // Reuse across hot reloads in development so we do not exhaust connections.
  const client = globalThis.__eaSql ?? createClient();

  if (process.env.NODE_ENV !== "production") globalThis.__eaSql = client;

  instance = drizzle(client, { schema });
  return instance;
}

export { schema };
