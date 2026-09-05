"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { normaliseEmail } from "@/lib/auth/allowlist";
import { can, inRequest, requireAccess } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";

export type MemberResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Only an owner manages access. An accountant may change rates and build
 * reports; deciding who else gets in is a different kind of decision.
 */
async function requireOwner() {
  const user = await requireAccess();

  if (!can(user, "team", "edit")) throw new Error("Only an owner can manage access.");

  return user;
}

const inviteSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["owner", "accountant", "viewer"]),
});

export async function inviteMember(input: unknown): Promise<MemberResult> {
  return inRequest(() => inviteMemberInScope(input));
}

async function inviteMemberInScope(input: unknown): Promise<MemberResult> {
  const user = await requireOwner();
  const parsed = inviteSchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: "A valid email address is required." };

  const email = normaliseEmail(parsed.data.email);
  const db = getDb();

  // No longer a refusal when the address already works somewhere else: an
  // accountant can keep the books for two companies, and each owner invites
  // them to their own without either knowing about the other. What one owner
  // cannot do is see, or touch, the other company's invitation — the
  // uniqueness, and the database's own check, are both per company.
  await db
    .insert(schema.allowedEmails)
    .values({ tenantId: user.tenantId, email, role: parsed.data.role, isActive: true })
    .onConflictDoUpdate({
      target: [schema.allowedEmails.tenantId, schema.allowedEmails.email],
      set: { role: parsed.data.role, isActive: true },
    });

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    { action: "member.invited", entity: "allowed_email", payload: { email, role: parsed.data.role } },
  );

  revalidatePath("/settings");

  return { ok: true, message: `${email} can now sign in as ${parsed.data.role}.` };
}

const changeSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["owner", "accountant", "viewer"]).optional(),
  isActive: z.boolean().optional(),
});

export async function updateMember(input: unknown): Promise<MemberResult> {
  return inRequest(() => updateMemberInScope(input));
}

async function updateMemberInScope(input: unknown): Promise<MemberResult> {
  const user = await requireOwner();
  const parsed = changeSchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: "Nothing to change." };

  const db = getDb();

  const [target] = await db
    .select({ email: schema.allowedEmails.email, role: schema.allowedEmails.role })
    .from(schema.allowedEmails)
    .where(
      and(
        eq(schema.allowedEmails.id, parsed.data.id),
        eq(schema.allowedEmails.tenantId, user.tenantId),
      ),
    )
    .limit(1);

  if (!target) return { ok: false, message: "No such member." };

  // Locking yourself out is the one mistake nobody can undo from inside the
  // application, so it is refused rather than confirmed.
  const removingSelf = normaliseEmail(target.email) === normaliseEmail(user.email);
  const losingOwnership = parsed.data.isActive === false || parsed.data.role !== "owner";

  if (removingSelf && losingOwnership) {
    return { ok: false, message: "You cannot remove your own access. Ask another owner." };
  }

  if (target.role === "owner" && losingOwnership) {
    const owners = await db
      .select({ id: schema.allowedEmails.id })
      .from(schema.allowedEmails)
      .where(
        and(
          eq(schema.allowedEmails.tenantId, user.tenantId),
          eq(schema.allowedEmails.role, "owner"),
          eq(schema.allowedEmails.isActive, true),
        ),
      );

    if (owners.length <= 1) {
      return { ok: false, message: "This is the last owner. Appoint another one first." };
    }
  }

  await db
    .update(schema.allowedEmails)
    .set({
      ...(parsed.data.role ? { role: parsed.data.role } : {}),
      ...(parsed.data.isActive === undefined ? {} : { isActive: parsed.data.isActive }),
    })
    .where(eq(schema.allowedEmails.id, parsed.data.id));

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    {
      action: parsed.data.isActive === false ? "member.suspended" : "member.updated",
      entity: "allowed_email",
      entityId: parsed.data.id,
      payload: { email: target.email, role: parsed.data.role, isActive: parsed.data.isActive },
    },
  );

  revalidatePath("/settings");

  return { ok: true, message: `${target.email} updated.` };
}

const nameSchema = z.object({
  /** Absent means the signed-in person's own name. */
  email: z.string().trim().email().optional(),
  name: z.string().trim().max(120),
});

/**
 * What a person is called.
 *
 * Google supplies one at first sign-in, and it is often not what colleagues
 * call them — or it is a personal account's name on a work address. So it is
 * editable, by the person themselves and by the owner of a company they are
 * in. Nobody else: a name is shown next to what somebody did, and a stranger
 * rewriting it would be rewriting the record of their work.
 *
 * By address, not by account id, because that is how everything else here
 * identifies a person: the access list is a list of addresses, and an
 * invitation exists before the account does.
 *
 * Empty clears it and the address stands in again. That is a real choice, not
 * a mistake to reject.
 */
export async function saveUserName(input: unknown): Promise<MemberResult> {
  return inRequest(() => saveUserNameInScope(input));
}

async function saveUserNameInScope(input: unknown): Promise<MemberResult> {
  const user = await requireAccess();
  const parsed = nameSchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: "A name is at most 120 characters." };

  const { name } = parsed.data;
  const target = normaliseEmail(parsed.data.email ?? user.email);
  const own = target === normaliseEmail(user.email);

  if (!own && !can(user, "team", "edit")) {
    return { ok: false, message: "Only an owner can rename somebody else." };
  }

  const db = getDb();

  // Somebody else's name is the owner's to change only while that person is on
  // this company's list. Without this the action would rename any account in
  // the system by address.
  if (!own) {
    const [member] = await db
      .select({ email: schema.allowedEmails.email })
      .from(schema.allowedEmails)
      .where(
        and(
          eq(schema.allowedEmails.tenantId, user.tenantId),
          eq(schema.allowedEmails.email, target),
        ),
      )
      .limit(1);

    if (!member) return { ok: false, message: "That address is not on this company's list." };
  }

  const [updated] = await db
    .update(schema.users)
    .set({ name: name === "" ? null : name })
    .where(eq(schema.users.email, target))
    .returning({ email: schema.users.email });

  // Invited, never arrived. There is no account to name yet, and saying so is
  // better than a success that changes nothing.
  if (!updated) {
    return { ok: false, message: `${target} has not signed in yet, so there is nothing to name.` };
  }

  await record(
    { id: user.id, email: user.email, tenantId: user.tenantId },
    {
      action: own ? "user.renamed_self" : "user.renamed",
      entity: "user",
      entityId: target,
      payload: { name: name === "" ? null : name },
    },
  );

  // The name is in the header and in every activity row, so the whole shell
  // has to be rebuilt, not just the screen it was changed on.
  revalidatePath("/", "layout");

  return {
    ok: true,
    message: name === "" ? "Name cleared — the address is shown instead." : `Saved as ${name}.`,
  };
}
