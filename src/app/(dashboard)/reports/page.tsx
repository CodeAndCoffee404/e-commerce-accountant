import { PageHeader } from "@/components/layout/page-header";
import { ReportsView } from "@/components/reports/reports-view";
import { requireUser } from "@/lib/auth/session";
import {
  availablePeriods,
  listReportRuns,
  loadReportSettings,
  missingChannelRules,
} from "@/lib/reports/queries";

export const metadata = { title: "Reports — E-commerce Accountant" };

export default async function ReportsPage() {
  const user = await requireUser();
  const settings = await loadReportSettings(user.tenantId);
  const [runs, periods, missingRules] = await Promise.all([
    listReportRuns(user.tenantId),
    availablePeriods(user.tenantId, settings),
    missingChannelRules(user.tenantId, settings),
  ]);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Each report records the uploads, the rules and the exchange rates it used, so rebuilding a period gives the same numbers."
      />
      <ReportsView
        runs={runs}
        periods={periods}
        missingRules={missingRules}
        canBuild={user.role !== "viewer"}
        canRestore={user.role === "owner"}
      />
    </>
  );
}
