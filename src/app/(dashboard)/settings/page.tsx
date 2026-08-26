import { SettingsView } from "@/components/settings/settings-view";
import { listAudit } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";
import { googlePickerApiKey } from "@/lib/env";
import { loadConnection } from "@/lib/google/connection";
import { listMembers } from "@/lib/members/queries";
import { loadPeriodConfiguration } from "@/lib/periods/ensure";
import { loadReferenceData } from "@/lib/reference/queries";
import { loadDeadlineRules } from "@/lib/reports/deadlines-queries";
import { loadReportSettings } from "@/lib/reports/queries";

export const metadata = { title: "Settings — E-commerce Accountant" };

export default async function SettingsPage() {
  const user = await requireUser();
  const [data, reports, periods, connection, members, audit] = await Promise.all([
    loadReferenceData(user.tenantId),
    loadReportSettings(user.tenantId),
    loadPeriodConfiguration(user.tenantId),
    loadConnection(user.tenantId),
    listMembers(user.tenantId),
    listAudit(user.tenantId),
  ]);
  const deadlineRules = await loadDeadlineRules(user.tenantId, reports);

  // No PageHeader here on purpose: the app bar already says Settings, and a
  // page that opens with a greeting does not introduce itself twice.
  return (
    <>
      <SettingsView
        data={data}
        reports={reports}
        deadlineRules={deadlineRules}
        schedule={periods.schedule}
        connection={connection}
        pickerApiKey={googlePickerApiKey()}
        members={members}
        selfEmail={user.email}
        audit={audit}
        // The client's rule: company settings are the owner's alone. An
        // accountant still sees everything — read-only.
        canEdit={user.role === "owner"}
        // Deadlines are a filing detail an accountant lives with day to day,
        // so both roles that can build reports may set them.
        canEditDeadlines={user.role === "owner" || user.role === "accountant"}
        isOwner={user.role === "owner"}
      />
    </>
  );
}
