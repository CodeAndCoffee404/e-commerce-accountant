import "dotenv/config";

import { defineConfig } from "drizzle-kit";

/**
 * Prefers the direct (unpooled) connection: Neon's pooler runs PgBouncer in
 * transaction mode, which is a poor fit for migrations.
 */
const url =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DEV_DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL ??
  process.env.DEV_DATABASE_URL ??
  "";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
