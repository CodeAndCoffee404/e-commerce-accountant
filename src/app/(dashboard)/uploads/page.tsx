import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";

export default function UploadsPage() {
  return (
    <>
      <PageHeader title="Uploads" description="Upload raw marketplace exports. Each file is recognised, assigned a period and parsed into transactions." />
      <ComingSoon stage="stage 1" />
    </>
  );
}
