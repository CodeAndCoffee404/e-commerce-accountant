import { PageHeader } from "@/components/layout/page-header";
import { SettingsView } from "@/components/settings/settings-view";
import { requireUser } from "@/lib/auth/session";
import { loadReferenceData } from "@/lib/reference/queries";

export default async function SettingsPage() {
  const user = await requireUser();
  const data = await loadReferenceData(user.tenantId);

  return (
    <>
      <PageHeader
        title="Settings"
        description="VAT rates, seller registrations, SKU mapping and channel rules. Nothing here is hard-coded — changing a rate does not need a developer."
      />
      <SettingsView data={data} canEdit={user.role !== "viewer"} />
    </>
  );
}
