import { Space } from "antd";

import { PageHeader } from "@/components/layout/page-header";
import { AuditCard } from "@/components/settings/audit-card";
import { DriveCard } from "@/components/settings/drive-card";
import { MembersCard } from "@/components/settings/members-card";
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
        description="VAT rates, seller registrations, SKU mapping and channel rules. Nothing here is hard-coded — changing a rate does not need a developer."
      />

      <Space direction="vertical" size="middle" style={{ width: "100%", marginBottom: 24 }}>
        <DriveCard
          connection={connection}
          apiKey={googlePickerApiKey()}
          canEdit={user.role !== "viewer"}
        />
        <MembersCard members={members} isOwner={user.role === "owner"} />
      </Space>

      <SettingsView data={data} reports={reports} canEdit={user.role !== "viewer"} />

      <div style={{ marginTop: 24 }}>
        <AuditCard rows={audit} />
      </div>
    </>
  );
}
