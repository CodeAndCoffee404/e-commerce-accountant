import { z } from "zod";

/**
 * Validated on first access rather than at import time: `next build` imports
 * modules without a full runtime environment, and a top-level throw would fail
 * the build instead of the request that actually needs the value.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
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

/** Individual accessors keep call sites from pulling in unrelated secrets. */
export function databaseUrl(): string {
  return requireVar("DATABASE_URL");
}

export function encryptionKeyHex(): string {
  return requireVar("ENCRYPTION_KEY");
}

function requireVar(name: keyof ServerEnv): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }

  return value;
}
