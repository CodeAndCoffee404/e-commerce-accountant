import { afterAll, describe, expect, it, vi } from "vitest";

import { and, eq } from "drizzle-orm";

import type { MembershipRole } from "@/lib/db/schema";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/audit/record", () => ({ record: async () => undefined }));

const session = {
  id: "schedule-user",
  email: "owner@example.test",
  tenantId: "",
  role: "owner" as MembershipRole,
};

/**
 * Signed in, and nothing else stubbed.
 *
 * The action asks `requireAccess` what this role may do, and that answer comes
 * from the real permission code reading the real table — so mocking the check
 * itself would test the mock. Only the session is invented; `requireUser` then
 * names the company for the queries below, exactly as it does in a request.
 */
vi.mock("@/auth", () => ({
  auth: async () => ({
    user: { id: session.id, email: session.email, name: "Test", image: null },
    tenantId: session.tenantId,
    role: session.role,
  }),
}));

const { getDb, schema } = await import("@/lib/db");
const { savePeriodSchedule } = await import("@/lib/periods/actions");
const { loadPeriodConfiguration } = await import("@/lib/periods/ensure");
const { PERIODS_CHANNEL, SCHEDULE_KEY } = await import("@/lib/periods/schedule");
const { inRequest } = await import("./helpers/request-scope");

/**
 * Saving the schedule is the only way a client turns a granularity on, and it
 * has to take effect at once. A switch that shows nothing until the small
 * hours reads as a switch that did not work.
 */

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const created: string[] = [];

afterAll(inRequest(async () => {
  if (!HAS_DB) return;

  for (const tenantId of created) {
    await getDb().delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  }
}));

async function asOwnerOfFreshTenant(): Promise<string> {
  const suffix = created.length + Date.now();
  const [tenant] = await getDb()
    .insert(schema.tenants)
    .values({ name: `Schedule ${suffix}`, slug: `schedule-${suffix}` })
    .returning({ id: schema.tenants.id });

  created.push(tenant.id);
  session.tenantId = tenant.id;
  session.role = "owner";

  return tenant.id;
}

describe.skipIf(!HAS_DB)("saving the period schedule", () => {
  it("opens what it has just turned on, without waiting for the scheduler", inRequest(async () => {
    const tenantId = await asOwnerOfFreshTenant();

    const result = await savePeriodSchedule({
      month: true,
      quarter: false,
      year: false,
      fiscalYearStartMonth: 1,
    });

    expect(result.ok).toBe(true);

    const before = await getDb()
      .select({ label: schema.periods.label })
      .from(schema.periods)
      .where(eq(schema.periods.tenantId, tenantId));

    expect(before.map((row) => row.label)).toHaveLength(1);

    const second = await savePeriodSchedule({
      month: true,
      quarter: true,
      year: false,
      fiscalYearStartMonth: 1,
    });

    expect(second.ok).toBe(true);
    // The quarter being lived through appears the moment it is switched on.
    expect(second.message).toMatch(/is now open|periods are now open/);

    const after = await getDb()
      .select({ granularity: schema.periods.granularity })
      .from(schema.periods)
      .where(eq(schema.periods.tenantId, tenantId));

    expect(after.filter((row) => row.granularity === "quarter")).toHaveLength(1);
  }));

  it("stores the schedule where the rest of the configuration lives", inRequest(async () => {
    const tenantId = await asOwnerOfFreshTenant();

    await savePeriodSchedule({
      month: true,
      quarter: false,
      year: true,
      fiscalYearStartMonth: 4,
    });

    const [row] = await getDb()
      .select({ value: schema.channelRules.value })
      .from(schema.channelRules)
      .where(
        and(
          eq(schema.channelRules.tenantId, tenantId),
          eq(schema.channelRules.channel, PERIODS_CHANNEL),
          eq(schema.channelRules.key, SCHEDULE_KEY),
        ),
      );

    expect(row.value).toEqual({
      month: true,
      quarter: false,
      year: true,
      fiscalYearStartMonth: 4,
    });

    const { schedule } = await loadPeriodConfiguration(tenantId);

    expect(schedule.fiscalYearStartMonth).toBe(4);
  }));

  it("refuses a schedule that opens nothing", inRequest(async () => {
    await asOwnerOfFreshTenant();

    const result = await savePeriodSchedule({
      month: false,
      quarter: false,
      year: false,
      fiscalYearStartMonth: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("At least one period");
  }));

  it("refuses a month outside the calendar rather than moving the year to one", inRequest(async () => {
    await asOwnerOfFreshTenant();

    const result = await savePeriodSchedule({
      month: true,
      quarter: true,
      year: true,
      fiscalYearStartMonth: 13,
    });

    expect(result.ok).toBe(false);
  }));

  it("refuses a role the owner has not given the schedule to", inRequest(async () => {
    await asOwnerOfFreshTenant();
    session.role = "accountant";

    const result = await savePeriodSchedule({
      month: true,
      quarter: true,
      year: true,
      fiscalYearStartMonth: 1,
    });

    expect(result.ok).toBe(false);
    // The refusal names the role's permission, not ownership: since the owner
    // can hand this section to a role, "only the owner" stopped being true.
    expect(result.message).toContain("Your role cannot change the period schedule");
  }));
});
