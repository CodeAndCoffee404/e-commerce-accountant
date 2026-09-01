"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record } from "@/lib/audit/record";
import { normaliseEmail } from "@/lib/auth/allowlist";
import { requireAccess } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";

export type MemberResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Only an owner manages access. An accountant may change rates and build
 * reports; deciding who else gets in is a different kind of decision.
 */
async function requireOwner() {
  const user = await requireAccess();

  if (!user.can("team", "edit")) throw new Error("Only an owner can manage access.");

  return user;
}

const inviteSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["owner", "accountant", "viewer"]),
});

export async function inviteMember(input: unknown): Promise<MemberResult> {
  const user = await requireOwner();
  const parsed = inviteSchema.safeParse(input);

  if (!parsed.success) return { ok: false, message: "A valid email address is required." };

  const email = normaliseEmail(parsed.data.email);
  const db = getDb();

  // The allowlist is unique on email across all tenants: one person belongs to
  // one tenant, and a silent move between them would be worse than a refusal.
  const [existing] = await db
    .select({ tenantId: schema.allowedEmails.tenantId })
    .from(schema.allowedEmails)
    .where(eq(schema.allowedEmails.email, email))
    .limit(1);

  if (existing && existing.tenantId !== user.tenantId) {
    return { ok: false, message: "That address already has access to another account." };
  }

  await db
    .insert(schema.allowedEmails)
    .values({ tenantId: user.tenantId, email, role: parsed.data.role, isActive: true })
    .onConflictDoUpdate({
      target: schema.allowedEmails.email,
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
