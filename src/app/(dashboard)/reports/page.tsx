import { ReportsView } from "@/components/reports/reports-view";
import { requireUser } from "@/lib/auth/session";
import {
  allReportPeriodRows,
  availablePeriods,
  listReportRuns,
  loadReportSettings,
  missingChannelRules,
} from "@/lib/reports/queries";

export const metadata = { title: "Reports — E-commerce Accountant" };

export default async function ReportsPage() {
  const user = await requireUser();
  const settings = await loadReportSettings(user.tenantId);
  const [periods, missingRules, runs] = await Promise.all([
    availablePeriods(user.tenantId, settings),
    missingChannelRules(user.tenantId, settings),
    listReportRuns(user.tenantId),
  ]);
  const periodRows = await allReportPeriodRows(user.tenantId, periods);

  // No PageHeader here on purpose: the app bar already says Reports, and a
  // page that opens with a greeting does not introduce itself twice.
  return (
    <>
      <ReportsView
        periods={periods}
        periodRows={periodRows}
        runs={runs}
        missingRules={missingRules}
        canBuild={user.role !== "viewer"}
        canRestore={user.role === "owner"}
        canEditSkuMappings={user.role === "owner"}
        canEditCurrencyMappings={user.role === "owner"}
      />
    </>
  );
}
