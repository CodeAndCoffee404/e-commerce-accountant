import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { databaseUrl } from "@/lib/env";

import * as schema from "./schema";

declare global {
  var __eaSql: ReturnType<typeof postgres> | undefined;
}

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

// Reuse across hot reloads in development so we do not exhaust connections.
const client = globalThis.__eaSql ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__eaSql = client;
}

export const db = drizzle(client, { schema });
export { schema };
