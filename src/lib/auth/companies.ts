"use server";

import { revalidatePath } from "next/cache";

import { auth, unstable_update } from "@/auth";
import { companiesFor, roleFor, type Company } from "@/lib/auth/allowlist";

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
 * The membership is checked here rather than trusted from the form: the target
 * arrives from the browser, and the token is written from whatever this
 * function decides. A company somebody is not in is refused rather than
 * silently ignored, because the difference matters to whoever is reading the
 * screen afterwards.
 */
export async function switchCompany(tenantId: unknown): Promise<SwitchResult> {
  const session = await auth();
  const email = session?.user?.email;

  if (!email) return { ok: false, message: "Sign in first." };
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, message: "No company chosen." };
  }

  // `roleFor` scopes itself to the company being asked about, which is the
  // right amount of access for the question — no wider.
  const role = await roleFor(email, tenantId);

  if (!role) return { ok: false, message: "You are not a member of that company." };

  await unstable_update({ tenantId });

  // Every screen belongs to a company, so all of them are now stale.
  revalidatePath("/", "layout");

  return { ok: true, tenantId };
}
