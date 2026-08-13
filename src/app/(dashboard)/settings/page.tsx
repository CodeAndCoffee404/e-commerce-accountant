import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="VAT rates, seller VAT numbers, SKU mapping, channel rules and integrations." />
      <ComingSoon stage="stage 3" />
    </>
  );
}
