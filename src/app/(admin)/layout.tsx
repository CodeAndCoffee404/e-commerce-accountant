import type { ReactNode } from "react";

import { AdminShell } from "@/components/admin/admin-shell";
import { requireSuperAdmin } from "@/lib/auth/session";

/**
 * The admin area's own shell.
 *
 * Deliberately not the dashboard's: that one is built around a company — its
 * menu, its badge, its company name in the bar — and this screen is above all
 * of them. Sharing a shell would mean showing a company while looking at the
 * list of companies.
 *
 * The frame itself lives in a client component. See `AdminShell` for why that
 * is not a matter of taste.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  // The guard sits here as well as on the page: a layout is what a future
  // second admin screen would be added under, and it should not have to
  // remember.
  await requireSuperAdmin();

  return <AdminShell>{children}</AdminShell>;
}
