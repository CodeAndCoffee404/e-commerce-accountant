import { DashboardView } from "@/components/dashboard/dashboard-view";
import { UploadDialog } from "@/components/uploads/upload-dialog";
import { one } from "@/lib/params";
import { listAudit } from "@/lib/audit/record";
import { can, requireSection } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/dashboard/queries";
import { loadConnection } from "@/lib/google/connection";
import { loadReportDeadlines } from "@/lib/reports/deadlines-queries";
import { countNeedsAttention } from "@/lib/transactions/queries";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireSection("dashboard");
  const params = await searchParams;

  // Deadlines are about the month shown on the dashboard, so they wait on it
  // rather than joining the initial fan-out.
  const data = await loadDashboard(user.tenantId, one(params.month));

  const [activity, flaggedRows, deadlines, connection] = await Promise.all([
    // Ten so the Activity card has something to expand into: it shows six
    // and offers the rest in place. Empty for a role the log is closed to —
    // the card renders nothing at all rather than a locked panel.
    can(user, "activity", "view") ? listAudit(user.tenantId, 10) : Promise.resolve([]),
    countNeedsAttention(user.tenantId),
    data.month ? loadReportDeadlines(user.tenantId, data.month) : Promise.resolve([]),
    // Whether a built report that is not in Drive is *waiting* to go or was
    // never going anywhere. Without this the screen cannot tell the two
    // apart, and says "not in Drive yet" to a tenant that never connected it.
    loadConnection(user.tenantId),
  ]);

  // No PageHeader here on purpose: the app bar already says Dashboard, and
  // the page opens by naming the month it is about.
  return (
    <DashboardView
      data={data}
      activity={activity}
      flaggedRows={flaggedRows}
      deadlines={deadlines}
      driveConnected={Boolean(connection?.folderId)}
      canBuild={can(user, "reports", "edit")}
      canEditSkuMappings={can(user, "settings_company", "edit")}
      canEditCurrencyMappings={can(user, "settings_company", "edit")}
      uploadAction={
        can(user, "source_files", "edit") ? <UploadDialog tenantId={user.tenantId} /> : null
      }
    />
  );
}
