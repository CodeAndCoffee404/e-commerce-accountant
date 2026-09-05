import { AppShell } from "@/components/layout/app-shell";
import { myCompanies } from "@/lib/auth/companies";
import { inRequest, requireAccess } from "@/lib/auth/session";
import { countNeedsAttention } from "@/lib/transactions/queries";

export default async function DashboardLayout(props: LayoutProps<"/">) {
  // Which companies this person has is a question about them, not about the
  // company being worked in — so it is asked out here, before the scope opens.
  // Inside it the answer would have to reach across companies, which is
  // exactly what the scope refuses.
  const companies = await myCompanies();

  return inRequest(() => dashboardLayout(props, companies));
}

// One page, one unit of work: the transaction underneath has told Postgres
// which company this is for, and every query below runs inside it.
async function dashboardLayout(
  { children }: LayoutProps<"/">,
  companies: Awaited<ReturnType<typeof myCompanies>>,
) {
  // proxy.ts only checks that a cookie exists. This is the check that counts.
  const user = await requireAccess();
  const needsAttention = await countNeedsAttention(user.tenantId);
  const current = companies.find((company) => company.id === user.tenantId);

  return (
    <AppShell
      user={user}
      access={user.access}
      needsAttention={needsAttention}
      company={current?.name ?? "This company"}
      companyBlocked={user.companyBlocked}
      companies={companies}
    >
      {children}
    </AppShell>
  );
}
