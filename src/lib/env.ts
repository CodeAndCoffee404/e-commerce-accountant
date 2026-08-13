import { z } from "zod";

/**
 * Validated on first access rather than at import time: `next build` imports
 * modules without a full runtime environment, and a top-level throw would fail
 * the build instead of the request that actually needs the value.
 */
const serverSchema = z.object({
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  BLOB_READ_WRITE_TOKEN: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`Invalid server environment:\n${missing}`);
  }

  cached = parsed.data;
  return cached;
}

/**
 * Connection strings come from two Neon projects wired through the Vercel
 * marketplace. `ea-prod` is connected to Production without a prefix, while
 * `ea-dev` is connected to Preview and Development under the `DEV_` prefix,
 * because two integrations cannot both claim the bare name.
 *
 * Only one of the two is ever present in a given environment, so a fallback
 * chain is unambiguous — and it beats hand-copying the value into a second
 * variable that silently goes stale when Neon rotates the password.
 */
const POOLED_URL_VARS = ["DATABASE_URL", "DEV_DATABASE_URL"] as const;

/**
 * Migrations run over the direct connection. Neon's pooler runs PgBouncer in
 * transaction mode, which does not reliably carry the session state some DDL
 * needs.
 */
const DIRECT_URL_VARS = [
  "DATABASE_URL_UNPOOLED",
  "DEV_DATABASE_URL_UNPOOLED",
  ...POOLED_URL_VARS,
] as const;

export function databaseUrl(): string {
  return firstDefined(POOLED_URL_VARS, "a pooled Postgres connection string");
}

export function migrationDatabaseUrl(): string {
  return firstDefined(DIRECT_URL_VARS, "a direct Postgres connection string");
}

export function encryptionKeyHex(): string {
  return firstDefined(["ENCRYPTION_KEY"], "ENCRYPTION_KEY");
}

function firstDefined(names: readonly string[], description: string): string {
  for (const name of names) {
    const value = process.env[name];

    if (value) return value;
  }

  throw new Error(
    `Missing ${description}. Set one of: ${names.join(", ")}`,
  );
}
