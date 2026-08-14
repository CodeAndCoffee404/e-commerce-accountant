import { PageHeader } from "@/components/layout/page-header";
import { DriveCard } from "@/components/settings/drive-card";
import { SettingsView } from "@/components/settings/settings-view";
import { requireUser } from "@/lib/auth/session";
import { googlePickerApiKey } from "@/lib/env";
import { loadConnection } from "@/lib/google/connection";
import { loadReferenceData } from "@/lib/reference/queries";

export default async function SettingsPage() {
  const user = await requireUser();
  const [data, connection] = await Promise.all([
    loadReferenceData(user.tenantId),
    loadConnection(user.tenantId),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="VAT rates, seller registrations, SKU mapping and channel rules. Nothing here is hard-coded — changing a rate does not need a developer."
      />
      <div style={{ marginBottom: 24 }}>
        <DriveCard
          connection={connection}
          apiKey={googlePickerApiKey()}
          canEdit={user.role !== "viewer"}
        />
      </div>

      <SettingsView data={data} canEdit={user.role !== "viewer"} />
    </>
  );
}
