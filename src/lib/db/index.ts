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
 * The real pooling belongs to Neon's pooler endpoint, not to this process, so
 * these numbers are about one function instance and not about the database.
 *
 * `max: 4` rather than 1. A page renders its layout and its content at the
 * same time, and each opens its own transaction: on a single connection the
 * second waited for the first, which is what made the skeleton arrive after
 * the content it was meant to stand in for. Under Vercel's concurrent
 * execution one instance also serves several requests at once, and they queued
 * behind each other for the same reason. Four is enough to stop the queue
 * without a function instance holding a handful of pooler slots idle.
 *
 * `idle_timeout: 120` rather than 20. Twenty seconds is shorter than a pause
 * for a cup of tea, so the next click paid for a fresh TCP handshake, TLS and
 * authentication before its first query.
 */
function createClient() {
  return postgres(databaseUrl(), {
    max: 4,
    idle_timeout: 120,
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
  // Inside a request the queries run on the transaction that has already named
  // the company to Postgres. Preferring it here is what keeps row-level
  // security out of the thirty other files that call this function.
  //
  // The cast is the one place this module is less than honest: a transaction
  // handle carries every query method a `Database` does and differs only by
  // `$client`, which nothing in this application reads.
  const scoped = currentExecutor();

  if (scoped) return scoped as Database;

  return rootDb();
}

/**
 * The connection itself, ignoring whatever scope is in force.
 *
 * Two callers only: whoever is about to open the transaction a scope runs in,
 * and the Auth.js adapter, which keeps whatever it is handed and so must not
 * be given a transaction that ends. Auth.js rebuilds its config on every call,
 * so the adapter would otherwise pick up whichever scope happened to be open.
 */
export function rootDb(): Database {
  if (instance) return instance;

  // Reuse across hot reloads in development so we do not exhaust connections.
  const client = globalThis.__eaSql ?? createClient();

  if (process.env.NODE_ENV !== "production") globalThis.__eaSql = client;

  instance = drizzle(client, { schema });
  return instance;
}

export { schema };
