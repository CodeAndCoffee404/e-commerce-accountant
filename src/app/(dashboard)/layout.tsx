import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  // proxy.ts only checks that a cookie exists. This is the check that counts.
  const user = await requireUser();

  return <AppShell user={user}>{children}</AppShell>;
}
