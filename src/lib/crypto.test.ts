import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, generateEncryptionKey } from "./crypto";

const KEY = "0".repeat(64);

describe("secret envelope", () => {
  it("round-trips a value", () => {
    const secret = "1//0gRefreshTokenExample-with-ünïcode";

    expect(decryptSecret(encryptSecret(secret, KEY), KEY)).toBe(secret);
  });

  it("produces a different ciphertext each time", () => {
    expect(encryptSecret("same", KEY)).not.toBe(encryptSecret("same", KEY));
  });

  it("rejects a value encrypted under another key", () => {
    const envelope = encryptSecret("secret", KEY);

    expect(() => decryptSecret(envelope, "f".repeat(64))).toThrow();
  });

  it("rejects a tampered payload", () => {
    const envelope = encryptSecret("secret", KEY);
    const payload = Buffer.from(envelope.slice(3), "base64");
    payload[payload.length - 1] ^= 0xff;

    expect(() => decryptSecret(`v1:${payload.toString("base64")}`, KEY)).toThrow();
  });

  it("rejects an unknown version prefix", () => {
    expect(() => decryptSecret("v9:AAAA", KEY)).toThrow(/Unsupported secret version/);
  });

  it("generates 32-byte keys", () => {
    expect(generateEncryptionKey()).toMatch(/^[0-9a-f]{64}$/);
  });
});
