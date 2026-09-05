import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Says why a migration failed, after `drizzle-kit migrate` has refused to.
 *
 * The CLI exits 1 having printed nothing but the two harmless notices about
 * its own bookkeeping tables, so the build stops with `exited with 1` and no
 * hint of what Postgres objected to. The production connection string is
 * Sensitive and cannot be read back, so nobody can reproduce it by hand
 * either: the build log is the only place the reason can ever appear.
 *
 * It runs only when the CLI has already failed — `npm run db:migrate` is
 * `drizzle-kit migrate || node scripts/migrate.mjs`. Applying stays the CLI's
 * job on the path where it works, and a failed migration is a transaction that
 * rolled back, so attempting it a second time to hear the error costs nothing.
 * The migrator here is the same one the CLI wraps, over the same folder and
 * the same `drizzle.__drizzle_migrations` journal.
 */

// Vercel puts the variables in the environment; locally they are in a file,
// which is why drizzle.config.ts reads the same two.
config({ path: [".env.local", ".env"] });

/**
 * The direct connection, in the order `src/lib/env.ts` looks for it. Migrations
 * do not go through the pooler: it is PgBouncer in transaction mode, which does
 * not reliably carry the session state some DDL needs.
 */
const URL_VARS = [
  "DATABASE_URL_UNPOOLED",
  "DEV_DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "DEV_POSTGRES_URL_NON_POOLING",
  "DATABASE_URL",
  "DEV_DATABASE_URL",
  "POSTGRES_URL",
  "DEV_POSTGRES_URL",
];

const chosen = URL_VARS.find((name) => (process.env[name] ?? "").length > 0);

if (!chosen) {
  console.error(
    `No direct Postgres connection string. Set one of: ${URL_VARS.join(", ")}`,
  );
  process.exit(1);
}

// The name, never the value: this line ends up in a build log.
console.log(`migrate: connecting via ${chosen}`);

const client = postgres(process.env[chosen], { max: 1, prepare: false });

try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  // Reached when the CLI failed for a reason that has since cleared — a
  // lost connection, a lock that has been released. Worth saying so.
  console.log("migrate: applied on the second attempt");
} catch (error) {
  // Everything Postgres said, because the one line that matters is usually in
  // `cause`, and the position and the failing statement are what turn "it
  // failed" into a fix.
  console.error("migrate: FAILED");
  console.error(error instanceof Error ? error.message : error);

  const cause = error?.cause;

  if (cause) {
    console.error(`cause: ${cause.message ?? cause}`);
    for (const field of ["code", "detail", "hint", "position", "where", "table", "constraint"]) {
      if (cause[field]) console.error(`${field}: ${cause[field]}`);
    }
  }

  process.exitCode = 1;
} finally {
  await client.end();
}
