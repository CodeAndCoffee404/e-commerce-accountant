import { DashboardView } from "@/components/dashboard/dashboard-view";
import { UploadDialog } from "@/components/uploads/upload-dialog";
import { one } from "@/lib/params";
import { listAudit } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/dashboard/queries";
import { loadReportDeadlines } from "@/lib/reports/deadlines-queries";
import { countNeedsAttention } from "@/lib/transactions/queries";

export const metadata = { title: "Dashboard — E-commerce Accountant" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  const params = await searchParams;

  const [data, activity, flaggedRows, deadlines] = await Promise.all([
    loadDashboard(user.tenantId, one(params.month)),
    listAudit(user.tenantId, 8),
    countNeedsAttention(user.tenantId),
    loadReportDeadlines(user.tenantId),
  ]);

  // The greeting addresses a person, not an account. The email prefix is the
  // fallback for a Google account with no display name.
  const firstName = user.name?.split(" ")[0] ?? user.email.split("@")[0];

  // No PageHeader here on purpose: the app bar already says Dashboard, and a
  // page that opens with a greeting does not introduce itself twice.
  return (
    <DashboardView
      data={data}
      activity={activity}
      firstName={firstName}
      flaggedRows={flaggedRows}
      deadlines={deadlines}
      canBuild={user.role !== "viewer"}
      uploadAction={user.role === "viewer" ? null : <UploadDialog tenantId={user.tenantId} />}
    />
  );
}
