"use server";

import { revalidatePath } from "next/cache";

import { auth, unstable_update } from "@/auth";
import { companiesFor, roleFor, type Company } from "@/lib/auth/allowlist";
import { getDb, schema } from "@/lib/db";
import { withTenant } from "@/lib/db/tenant";

/**
 * Which company a session is working in, and how it moves to another.
 *
 * One person can keep the books for two companies, so the company is a choice
 * the session carries rather than a fact about the person. Everything else in
 * the application reads that choice and never questions it — which is why the
 * two functions here are careful about it: one only lists what is genuinely
 * theirs, the other refuses to write a company they are not in.
 */

/**
 * The companies this person may work in, for the switcher and the chooser.
 *
 * Called before a company has been chosen — from the chooser, which exists
 * precisely because none has, and from the shell, before it enters the one in
 * the session. Empty when nobody is signed in, which the caller reads as
 * nothing to offer.
 */
export async function myCompanies(): Promise<Company[]> {
  const session = await auth();

  if (!session?.user?.email) return [];

  return companiesFor(session.user.email);
}

export type SwitchResult = { ok: true; tenantId: string } | { ok: false; message: string };

/**
 * Moves the session to another company.
 *
 * The access list is checked here rather than trusted from the form: the target
 * arrives from the browser. A company somebody may not enter is refused rather
 * than silently ignored, because the difference matters to whoever is reading
 * the screen afterwards. The same check runs again where the token is written,
 * since that can be reached without coming through here at all.
 */
export async function switchCompany(tenantId: unknown): Promise<SwitchResult> {
  const session = await auth();
  const email = session?.user?.email;
  const userId = session?.user?.id;

  if (!email || !userId) return { ok: false, message: "Sign in first." };
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, message: "No company chosen." };
  }

  // `roleFor` scopes itself to the company being asked about, which is the
  // right amount of access for the question — no wider.
  const role = await roleFor(email, tenantId);

  if (!role) return { ok: false, message: "You are not a member of that company." };

  // Record that this person has now arrived in that company. The Team screen
  // reads memberships to say who has actually signed in, and somebody invited
  // after their last sign-in would otherwise show as "invited, never arrived"
  // while working there.
  await withTenant(tenantId, () =>
    getDb()
      .insert(schema.memberships)
      .values({ tenantId, userId, role })
      .onConflictDoNothing(),
  );

  await unstable_update({ tenantId });

  // Every screen belongs to a company, so all of them are now stale.
  revalidatePath("/", "layout");

  return { ok: true, tenantId };
}
