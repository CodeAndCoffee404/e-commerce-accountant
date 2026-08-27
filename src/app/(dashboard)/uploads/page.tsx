import { UploadDialog } from "@/components/uploads/upload-dialog";
import { UploadsTable } from "@/components/uploads/uploads-table";
import { one } from "@/lib/params";
import { requireUser } from "@/lib/auth/session";
import { listUploads, uploadFilterOptions, type UploadFilters } from "@/lib/uploads/queries";
import { reconcileFiles } from "@/lib/uploads/reconciliation";

export const metadata = { title: "Uploads — E-commerce Accountant" };

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

  // No PageHeader here on purpose: the app bar already says Uploads, and a
  // page that opens with a greeting does not introduce itself twice.
  return (
    <UploadsTable
      rows={rows}
      options={options}
      reconciliation={reconciliation}
      canDelete={user.role !== "viewer"}
      uploadAction={user.role !== "viewer" ? <UploadDialog tenantId={user.tenantId} /> : null}
    />
  );
}
