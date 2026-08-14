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
const POOLED_URL_VARS = [
  "DATABASE_URL",
  "DEV_DATABASE_URL",
  // Neon publishes the same pooled string under several names. Depending on one
  // of them turned out to be brittle: a tidy-up script deleted DATABASE_URL and
  // took production offline while POSTGRES_URL sat there holding the same value.
  "POSTGRES_URL",
  "DEV_POSTGRES_URL",
] as const;

/**
 * Migrations run over the direct connection. Neon's pooler runs PgBouncer in
 * transaction mode, which does not reliably carry the session state some DDL
 * needs.
 */
const DIRECT_URL_VARS = [
  "DATABASE_URL_UNPOOLED",
  "DEV_DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "DEV_POSTGRES_URL_NON_POOLING",
  ...POOLED_URL_VARS,
] as const;

export function databaseUrl(): string {
  return firstDefined(POOLED_URL_VARS, "a pooled Postgres connection string");
}

export function migrationDatabaseUrl(): string {
  return firstDefined(DIRECT_URL_VARS, "a direct Postgres connection string");
}

/**
 * Browser key for Google's file picker. Not a secret in the usual sense — it
 * travels to the client by design and is restricted by HTTP referrer in the
 * Google console. Absent, the picker simply cannot open, so it is optional
 * here rather than required at startup.
 */
export function googlePickerApiKey(): string | null {
  return process.env.GOOGLE_PICKER_API_KEY ?? null;
}

export function encryptionKeyHex(): string {
  return firstDefined(["ENCRYPTION_KEY"], "ENCRYPTION_KEY");
}

/**
 * Blob storage has no entry here on purpose. The project authenticates to it
 * by OIDC — `VERCEL_OIDC_TOKEN` plus `BLOB_STORE_ID`, both injected by Vercel
 * and refreshed by `vercel env pull` locally — so there is no static
 * BLOB_READ_WRITE_TOKEN to validate, and nothing long-lived to leak.
 */

function firstDefined(names: readonly string[], description: string): string {
  for (const name of names) {
    const value = process.env[name];

    if (value) return value;
  }

  throw new Error(
    `Missing ${description}. Set one of: ${names.join(", ")}`,
  );
}
