import { PageHeader } from "@/components/layout/page-header";
import { TransactionsView } from "@/components/transactions/transactions-view";
import { one } from "@/lib/params";
import { requireSection } from "@/lib/auth/session";
import {
  filterOptions,
  listTransactions,
  transactionTotals,
  type TransactionFilters,
} from "@/lib/transactions/queries";

export const metadata = { title: "Transactions" };

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const user = await requireSection("transactions");
  const params = await searchParams;

  const filters: TransactionFilters = {
    dataset: one(params.dataset),
    country: one(params.country),
    period: one(params.period),
    type: one(params.type),
    attention: one(params.attention) === "1",
    includeSuperseded: one(params.superseded) === "1",
    page: Number(one(params.page) ?? 1) || 1,
  };

  const [page, options, totals] = await Promise.all([
    listTransactions(user.tenantId, filters),
    filterOptions(user.tenantId),
    transactionTotals(user.tenantId, filters),
  ]);

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every uploaded file, parsed into one ledger. Any figure leads back to the row it came from."
      />
      <TransactionsView page={page} options={options} totals={totals} />
    </>
  );
}
