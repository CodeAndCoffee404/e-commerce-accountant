import { AdminView } from "@/components/admin/admin-view";
import { allCompanies } from "@/lib/admin/queries";
import { requireSuperAdmin } from "@/lib/auth/session";

export const metadata = { title: "Companies" };

/**
 * The screen above the companies: which of them exist, who is in each, and a
 * way into any of them.
 *
 * It names no company of its own — that is the point of it — so it reads
 * through `allCompanies`, which says `acrossTenants` outright and returns the
 * access list, counts and dates rather than anybody's rows.
 */
export default async function AdminPage() {
  const admin = await requireSuperAdmin();

  return <AdminView companies={await allCompanies()} current={admin.tenantId} />;
}
