import { AppShell } from "@/components/layout/app-shell";
import { inRequest, requireAccess } from "@/lib/auth/session";
import { countNeedsAttention } from "@/lib/transactions/queries";

export default async function DashboardLayout(props: LayoutProps<"/">) {
  return inRequest(() => dashboardLayout(props));
}

// One page, one unit of work: the transaction underneath has told Postgres
// which company this is for, and every query below runs inside it.
async function dashboardLayout({ children }: LayoutProps<"/">) {
  // proxy.ts only checks that a cookie exists. This is the check that counts.
  const user = await requireAccess();
  const needsAttention = await countNeedsAttention(user.tenantId);

  return (
    <AppShell user={user} access={user.access} needsAttention={needsAttention}>
      {children}
    </AppShell>
  );
}
