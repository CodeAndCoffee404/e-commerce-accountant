"use server";

import { signIn, signOut } from "@/auth";
import { DEFAULT_ROUTE } from "@/lib/navigation";

export async function signInWithGoogle(formData: FormData) {
  await signIn("google", { redirectTo: safeNext(formData.get("next")) });
}

/**
 * `next` reaches us through the query string, so it is attacker-controlled.
 * A leading `//` is protocol-relative and would send the user off-site after
 * a successful login, which is the classic open redirect.
 */
function safeNext(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return DEFAULT_ROUTE;
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_ROUTE;

  return value;
}

export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}
