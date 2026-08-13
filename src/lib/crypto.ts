import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { encryptionKeyHex } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

/**
 * Envelope for secrets at rest — currently Google refresh tokens.
 *
 * Stored as `v1:<base64>` where the payload is iv || authTag || ciphertext.
 * The version prefix exists so a future key rotation can decrypt old rows
 * while writing new ones under a new scheme.
 */
export function encryptSecret(plaintext: string, keyHex = encryptionKeyHex()): string {
  const key = parseKey(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);

  return `${VERSION}:${payload.toString("base64")}`;
}

export function decryptSecret(envelope: string, keyHex = encryptionKeyHex()): string {
  const separator = envelope.indexOf(":");

  if (separator === -1) {
    throw new Error("Malformed secret: missing version prefix");
  }

  const version = envelope.slice(0, separator);

  if (version !== VERSION) {
    throw new Error(`Unsupported secret version "${version}"`);
  }

  const payload = Buffer.from(envelope.slice(separator + 1), "base64");

  if (payload.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("Malformed secret: payload too short");
  }

  const iv = payload.subarray(0, IV_BYTES);
  const authTag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, parseKey(keyHex), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Convenience for `npm run generate:key`. */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString("hex");
}

function parseKey(keyHex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }

  return Buffer.from(keyHex, "hex");
}
