import { PageHeader } from "@/components/layout/page-header";
import { UploadDialog } from "@/components/uploads/upload-dialog";
import { UploadsTable } from "@/components/uploads/uploads-table";
import { requireUser } from "@/lib/auth/session";
import { listUploads, uploadFilterOptions, type UploadFilters } from "@/lib/uploads/queries";
import { reconcileFiles } from "@/lib/uploads/reconciliation";

export const metadata = { title: "Uploads — E-commerce Accountant" };

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function UploadsPage({ searchParams }: PageProps<"/uploads">) {
  const user = await requireUser();
  const params = await searchParams;

  const filters: UploadFilters = {
    dataset: one(params.dataset),
    period: one(params.period),
    status: one(params.status),
    search: one(params.q),
  };

  const [rows, options] = await Promise.all([
    listUploads(user.tenantId, filters),
    uploadFilterOptions(user.tenantId),
  ]);

  const reconciliation = Object.fromEntries(
    await reconcileFiles(
      user.tenantId,
      rows.map((row) => row.id),
    ),
  );

  return (
    <>
      <PageHeader
        title="Uploads"
        description="Upload raw marketplace exports. Each file is recognised, assigned a period and parsed into transactions."
        extra={<UploadDialog tenantId={user.tenantId} />}
      />
      <UploadsTable rows={rows} options={options} reconciliation={reconciliation} />
    </>
  );
}
