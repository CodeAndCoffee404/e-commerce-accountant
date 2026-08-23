import { PageHeader } from "@/components/layout/page-header";
import { SettingsView } from "@/components/settings/settings-view";
import { listAudit } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";
import { googlePickerApiKey } from "@/lib/env";
import { loadConnection } from "@/lib/google/connection";
import { listMembers } from "@/lib/members/queries";
import { loadPeriodConfiguration } from "@/lib/periods/ensure";
import { loadReferenceData } from "@/lib/reference/queries";
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

  return (
    <>
      <PageHeader
        title="Settings"
        description="Reports, rates, integrations and access. Nothing here needs a developer."
      />

      <SettingsView
        data={data}
        reports={reports}
        schedule={periods.schedule}
        connection={connection}
        pickerApiKey={googlePickerApiKey()}
        members={members}
        selfEmail={user.email}
        audit={audit}
        // The client's rule: company settings are the owner's alone. An
        // accountant still sees everything — read-only.
        canEdit={user.role === "owner"}
        // A report's reporting-start date is the one report setting an
        // accountant can move too — they are the one who knows when a client
        // actually started filing it.
        canEditEffectiveFrom={user.role === "owner" || user.role === "accountant"}
        isOwner={user.role === "owner"}
      />
    </>
  );
}
