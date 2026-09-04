import { AdminView } from "@/components/admin/admin-view";
import { requireSuperAdmin } from "@/lib/auth/session";
import { allCompanies } from "@/lib/admin/queries";

export const metadata = { title: "Companies" };

/**
 * The screen above the companies: which of them exist, and a way into each.
 *
 * It names no company of its own — that is the point of it — so it reads
 * through `allCompanies`, which says `acrossTenants` outright and returns
 * counts and dates rather than anybody's rows.
 */
export default async function AdminPage() {
  const admin = await requireSuperAdmin();

  return <AdminView companies={await allCompanies()} current={admin.tenantId} />;
}
