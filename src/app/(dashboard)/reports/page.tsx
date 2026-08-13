import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" description="Generate and download reports. Each run records its period, sources and Google Drive copy." />
      <ComingSoon stage="stage 4" />
    </>
  );
}
