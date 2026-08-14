import { PageHeader } from "@/components/layout/page-header";
import { SettingsView } from "@/components/settings/settings-view";
import { listAudit } from "@/lib/audit/record";
import { requireUser } from "@/lib/auth/session";
import { googlePickerApiKey } from "@/lib/env";
import { loadConnection } from "@/lib/google/connection";
import { listMembers } from "@/lib/members/queries";
import { loadReferenceData } from "@/lib/reference/queries";
import { loadReportSettings } from "@/lib/reports/queries";

export const metadata = { title: "Settings — E-commerce Accountant" };

export default async function SettingsPage() {
  const user = await requireUser();
  const [data, reports, connection, members, audit] = await Promise.all([
    loadReferenceData(user.tenantId),
    loadReportSettings(user.tenantId),
    loadConnection(user.tenantId),
    listMembers(user.tenantId),
    listAudit(user.tenantId),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="How the reports work, the numbers they use, where they go, and who may touch them. Nothing here is hard-coded — changing a rate does not need a developer."
      />

      <SettingsView
        data={data}
        reports={reports}
        connection={connection}
        pickerApiKey={googlePickerApiKey()}
        members={members}
        audit={audit}
        canEdit={user.role !== "viewer"}
        isOwner={user.role === "owner"}
      />
    </>
  );
}
