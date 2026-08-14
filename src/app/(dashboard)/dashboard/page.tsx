import { DashboardView } from "@/components/dashboard/dashboard-view";
import { PageHeader } from "@/components/layout/page-header";
import { UploadDialog } from "@/components/uploads/upload-dialog";
import { listAudit } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/dashboard/queries";
import { countNeedsAttention } from "@/lib/transactions/queries";

export const metadata = { title: "Dashboard — E-commerce Accountant" };

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  const params = await searchParams;

  const [data, activity, flaggedRows] = await Promise.all([
    loadDashboard(user.tenantId, one(params.month)),
    listAudit(user.tenantId, 8),
    countNeedsAttention(user.tenantId),
  ]);

  // The greeting addresses a person, not an account. The email prefix is the
  // fallback for a Google account with no display name.
  const firstName = user.name?.split(" ")[0] ?? user.email.split("@")[0];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="The month at a glance: what is in, what can be built, and what needs you."
        extra={user.role === "viewer" ? undefined : <UploadDialog tenantId={user.tenantId} />}
      />
      <DashboardView
        data={data}
        activity={activity}
        firstName={firstName}
        flaggedRows={flaggedRows}
        canBuild={user.role !== "viewer"}
      />
    </>
  );
}
