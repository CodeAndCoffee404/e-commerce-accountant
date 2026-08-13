import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Relative, not the `@/` alias: drizzle-kit loads this file with its own
// bundler and does not read tsconfig paths.
import { migrationDatabaseUrl } from "./src/lib/env";

// Next.js reads .env.local on its own; drizzle-kit does not, and plain
// `dotenv/config` would only look at .env.
config({ path: [".env.local", ".env"] });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: migrationDatabaseUrl() },
  strict: true,
  verbose: true,
});
