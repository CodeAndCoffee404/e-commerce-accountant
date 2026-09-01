import { AppShell } from "@/components/layout/app-shell";
import { requireAccess } from "@/lib/auth/session";
import { countNeedsAttention } from "@/lib/transactions/queries";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  // proxy.ts only checks that a cookie exists. This is the check that counts.
  const user = await requireAccess();
  const needsAttention = await countNeedsAttention(user.tenantId);

  return (
    <AppShell user={user} access={user.access} needsAttention={needsAttention}>
      {children}
    </AppShell>
  );
}
