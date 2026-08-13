import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";

export default function TransactionsPage() {
  return (
    <>
      <PageHeader title="Transactions" description="Every parsed transaction across all channels, traceable back to its source row." />
      <ComingSoon stage="stage 2" />
    </>
  );
}
