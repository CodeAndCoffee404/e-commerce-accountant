import { PageHeader } from "@/components/layout/page-header";
import { ReportsView } from "@/components/reports/reports-view";
import { requireUser } from "@/lib/auth/session";
import { availablePeriods, listReportRuns } from "@/lib/reports/queries";

export default async function ReportsPage() {
  const user = await requireUser();
  const [runs, periods] = await Promise.all([
    listReportRuns(user.tenantId),
    availablePeriods(user.tenantId),
  ]);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Each report records the uploads, the rules and the exchange rates it used, so rebuilding a period gives the same numbers."
      />
      <ReportsView runs={runs} periods={periods} canBuild={user.role !== "viewer"} />
    </>
  );
}
