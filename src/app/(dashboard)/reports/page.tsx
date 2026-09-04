import { ReportsView } from "@/components/reports/reports-view";
import { can, inRequest, requireSection } from "@/lib/auth/session";
import {
  allReportPeriodRows,
  availablePeriods,
  listReportRuns,
  loadReportSettings,
  missingChannelRules,
} from "@/lib/reports/queries";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  return inRequest(() => reportsPage());
}

// One page, one unit of work: the transaction underneath has told Postgres
// which company this is for, and every query below runs inside it.
async function reportsPage() {
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
        canBuild={can(user, "reports", "edit")}
        canRestore={can(user, "settings_company", "edit")}
        canEditSkuMappings={can(user, "settings_company", "edit")}
        canEditCurrencyMappings={can(user, "settings_company", "edit")}
      />
    </>
  );
}
