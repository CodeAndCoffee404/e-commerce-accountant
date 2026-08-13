import { describe, expect, it } from "vitest";

import { isBootstrapEmail, normaliseEmail, parseBootstrapEmails } from "./allowlist";

describe("parseBootstrapEmails", () => {
  it("returns nothing when the variable is unset", () => {
    expect(parseBootstrapEmails(undefined)).toEqual([]);
    expect(parseBootstrapEmails("")).toEqual([]);
  });

  it("splits on commas and trims whitespace", () => {
    expect(parseBootstrapEmails(" a@example.com , b@example.com ")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("lowercases, because Google returns the address as the user typed it", () => {
    expect(parseBootstrapEmails("Owner@Example.COM")).toEqual(["owner@example.com"]);
  });

  it("drops entries that are not addresses", () => {
    // A trailing comma or a stray handle must not turn into a wildcard entry.
    expect(parseBootstrapEmails("a@example.com,,handle,")).toEqual(["a@example.com"]);
  });
});

describe("isBootstrapEmail", () => {
  const list = "owner@example.com, second@example.com";

  it("matches regardless of case and padding", () => {
    expect(isBootstrapEmail("  OWNER@example.com ", list)).toBe(true);
  });

  it("rejects an address that is not listed", () => {
    expect(isBootstrapEmail("intruder@example.com", list)).toBe(false);
  });

  it("rejects everything when the list is empty", () => {
    expect(isBootstrapEmail("owner@example.com", undefined)).toBe(false);
    expect(isBootstrapEmail("owner@example.com", "")).toBe(false);
  });

  it("does not match on a substring", () => {
    expect(isBootstrapEmail("owner@example.com.evil.test", list)).toBe(false);
  });
});

describe("normaliseEmail", () => {
  it("trims and lowercases", () => {
    expect(normaliseEmail(" Mixed.Case@Example.com ")).toBe("mixed.case@example.com");
  });
});
