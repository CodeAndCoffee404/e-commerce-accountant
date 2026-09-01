import { ReportsView } from "@/components/reports/reports-view";
import { requireSection } from "@/lib/auth/session";
import {
  allReportPeriodRows,
  availablePeriods,
  listReportRuns,
  loadReportSettings,
  missingChannelRules,
} from "@/lib/reports/queries";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const user = await requireSection("reports");
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
        canBuild={user.can("reports", "edit")}
        canRestore={user.can("settings_company", "edit")}
        canEditSkuMappings={user.can("settings_company", "edit")}
        canEditCurrencyMappings={user.can("settings_company", "edit")}
      />
    </>
  );
}
