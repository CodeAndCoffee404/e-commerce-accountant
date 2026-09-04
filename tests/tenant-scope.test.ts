import { describe, expect, it } from "vitest";

import { acrossTenants, currentTenantId, requireTenantId, withTenant } from "@/lib/db/tenant";

/**
 * The scope's own rules — what it refuses, and what it keeps apart.
 *
 * Database-backed, because a scope is a transaction now: naming a company is
 * something said to Postgres, and there is nothing to say it on without a
 * connection.
 */

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("company scope", () => {
  it("has no company until one is named", () => {
    expect(currentTenantId()).toBeNull();
    expect(() => requireTenantId()).toThrow(/No company in scope/);
  });
});

describe.skipIf(!HAS_DB)("company scope, against a database", () => {
  it("names the company for the work inside it, and gives it back afterwards", async () => {
    const seen = await withTenant(A, async () => requireTenantId());

    expect(seen).toBe(A);
    expect(currentTenantId()).toBeNull();
  });

  it("keeps the company through awaits", async () => {
    await withTenant(A, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(currentTenantId()).toBe(A);
    });
  });

  it("lets the same company be named again, without a second transaction", async () => {
    await withTenant(A, async () => {
      await withTenant(A, async () => {
        expect(currentTenantId()).toBe(A);
      });
    });
  });

  it("refuses a second company in the same unit of work", async () => {
    await withTenant(A, async () => {
      expect(() => withTenant(B, async () => undefined)).toThrow(/cannot switch/);
    });
  });

  it("keeps two companies apart when they run at the same time", async () => {
    // The nightly job walks companies in turn; this is the shape of the bug
    // that would put one company's month into another's row.
    const [first, second] = await Promise.all([
      withTenant(A, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));

        return currentTenantId();
      }),
      withTenant(B, async () => currentTenantId()),
    ]);

    expect(first).toBe(A);
    expect(second).toBe(B);
  });

  it("carries the company into work started inside the scope", async () => {
    const later = await withTenant(A, async () => {
      const pending = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));

        return currentTenantId();
      })();

      return pending;
    });

    expect(later).toBe(A);
  });
});

describe.skipIf(!HAS_DB)("acrossTenants", () => {
  it("is a company-less scope, not the absence of one", async () => {
    await acrossTenants(async () => {
      expect(currentTenantId()).toBeNull();
      // And a company can still be named inside it, one at a time.
      await withTenant(A, async () => expect(currentTenantId()).toBe(A));
    });
  });

  it("refuses to widen a company's scope back out", async () => {
    await withTenant(A, async () => {
      expect(() => acrossTenants(async () => undefined)).toThrow(/would widen that back out/);
    });
  });
});
