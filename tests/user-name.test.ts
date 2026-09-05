import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * What a person is called, and who may say so.
 *
 * The name is shown beside everything somebody has done, so renaming is not a
 * cosmetic setting: it edits how the record of their work reads. Two people
 * may do it — the person themselves, and the owner of a company they are in.
 */

const session: { userId: string | null; tenantId: string | null; email: string | null } = {
  userId: null,
  tenantId: null,
  email: null,
};

vi.mock("@/auth", () => ({
  auth: async () =>
    session.userId && session.tenantId
      ? { user: { id: session.userId, email: session.email, name: null }, tenantId: session.tenantId }
      : null,
  unstable_update: async () => null,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`);
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { getDb, schema } = await import("@/lib/db");
const { acrossTenants } = await import("@/lib/db/tenant");
const { saveUserName } = await import("@/lib/members/actions");
const { listAudit } = await import("@/lib/audit/record");
const { inRequest } = await import("./helpers/request-scope");

const HAS_DB = ["DATABASE_URL", "DEV_DATABASE_URL", "POSTGRES_URL", "DEV_POSTGRES_URL"].some(
  (name) => (process.env[name] ?? "").length > 0,
);

const stamp = `${process.pid}-${Date.now()}`;
const tenants: string[] = [];
const people: string[] = [];

async function person(prefix: string, tenantId: string, role: "owner" | "viewer") {
  const id = `${prefix}-${stamp}`;
  const email = `${id}@example.invalid`;

  await getDb().insert(schema.users).values({ id, email }).onConflictDoNothing();
  await getDb()
    .insert(schema.allowedEmails)
    .values({ tenantId, email, role, isActive: true })
    .onConflictDoNothing();

  people.push(id);

  return { id, email };
}

async function company() {
  return acrossTenants(async () => {
    const [row] = await getDb()
      .insert(schema.tenants)
      .values({ name: `Names ${stamp}` })
      .returning({ id: schema.tenants.id });

    tenants.push(row.id);

    return row.id;
  });
}

function nameOf(email: string): Promise<string | null> {
  return acrossTenants(async () => {
    const [row] = await getDb()
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.email, email));

    return row?.name ?? null;
  });
}

describe.skipIf(!HAS_DB)("naming a person", () => {
  afterAll(
    inRequest(async () => {
      for (const id of tenants) {
        await getDb().delete(schema.tenants).where(eq(schema.tenants.id, id));
      }
      for (const id of people) {
        await getDb().delete(schema.users).where(eq(schema.users.id, id));
      }
    }),
  );

  it("lets a person name themselves, whatever their role", async () => {
    const tenantId = await company();
    // A viewer: the lowest role there is, and the Team screen is closed to it.
    // Their own name still has to be theirs, which is why the menu offers it.
    const viewer = await acrossTenants(() => person("viewer", tenantId, "viewer"));

    session.userId = viewer.id;
    session.email = viewer.email;
    session.tenantId = tenantId;

    expect((await saveUserName({ name: "Olga" })).ok).toBe(true);
    expect(await nameOf(viewer.email)).toBe("Olga");
  });

  it("clears the name rather than refusing an empty one", async () => {
    const tenantId = await company();
    const self = await acrossTenants(() => person("clearer", tenantId, "viewer"));

    session.userId = self.id;
    session.email = self.email;
    session.tenantId = tenantId;

    await saveUserName({ name: "Temporary" });

    // Emptying it is a decision — go back to being shown by address — not an
    // input error.
    expect((await saveUserName({ name: "  " })).ok).toBe(true);
    expect(await nameOf(self.email)).toBeNull();
  });

  it("lets an owner name somebody on their list", async () => {
    const tenantId = await company();
    const owner = await acrossTenants(() => person("owner", tenantId, "owner"));
    const other = await acrossTenants(() => person("other", tenantId, "viewer"));

    session.userId = owner.id;
    session.email = owner.email;
    session.tenantId = tenantId;

    expect((await saveUserName({ email: other.email, name: "Jan" })).ok).toBe(true);
    expect(await nameOf(other.email)).toBe("Jan");
  });

  it("refuses a viewer renaming somebody else", async () => {
    const tenantId = await company();
    const viewer = await acrossTenants(() => person("nosy", tenantId, "viewer"));
    const other = await acrossTenants(() => person("target", tenantId, "viewer"));

    session.userId = viewer.id;
    session.email = viewer.email;
    session.tenantId = tenantId;

    const result = await saveUserName({ email: other.email, name: "Renamed" });

    expect(result.ok).toBe(false);
    expect(await nameOf(other.email)).toBeNull();
  });

  it("refuses an owner renaming somebody outside their company", async () => {
    const here = await company();
    const elsewhere = await company();
    const owner = await acrossTenants(() => person("boss", here, "owner"));
    const stranger = await acrossTenants(() => person("stranger", elsewhere, "viewer"));

    session.userId = owner.id;
    session.email = owner.email;
    session.tenantId = here;

    // The address is not a secret, so without the list check this action would
    // be a way to rename any account in the system.
    const result = await saveUserName({ email: stranger.email, name: "Not yours" });

    expect(result.ok).toBe(false);
    expect(await nameOf(stranger.email)).toBeNull();
  });

  it("names the person in the activity log, and renames them everywhere at once", async () => {
    const tenantId = await company();
    const self = await acrossTenants(() => person("actor", tenantId, "owner"));

    session.userId = self.id;
    session.email = self.email;
    session.tenantId = tenantId;

    await saveUserName({ name: "First" });

    // The name is read when the log is shown, not stored with the entry. So
    // correcting it corrects every line already written — which is the point:
    // the log is a record of who did something, and that is still this person.
    await saveUserName({ name: "Second" });

    const rows = await acrossTenants(() => listAudit(tenantId, 10));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.userName === "Second")).toBe(true);
  });
});
