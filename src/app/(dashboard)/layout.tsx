import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";
import { countNeedsAttention } from "@/lib/transactions/queries";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  // proxy.ts only checks that a cookie exists. This is the check that counts.
  const user = await requireUser();
  const needsAttention = await countNeedsAttention(user.tenantId);

  return (
    <AppShell user={user} needsAttention={needsAttention}>
      {children}
    </AppShell>
  );
}
