import { UploadDialog } from "@/components/uploads/upload-dialog";
import { UploadsTable } from "@/components/uploads/uploads-table";
import { one } from "@/lib/params";
import { can, inRequest, requireSection } from "@/lib/auth/session";
import { listUploads, uploadFilterOptions, type UploadFilters } from "@/lib/uploads/queries";
import { reconcileFiles } from "@/lib/uploads/reconciliation";

export const metadata = { title: "Source files" };

export default async function SourceFilesPage(props: PageProps<"/source-files">) {
  return inRequest(() => sourceFilesPage(props));
}

// One page, one unit of work: the transaction underneath has told Postgres
// which company this is for, and every query below runs inside it.
async function sourceFilesPage({ searchParams }: PageProps<"/source-files">) {
  const user = await requireSection("source_files");
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

  // No PageHeader here on purpose: the app bar already says Source files, and a
  // page that opens with a greeting does not introduce itself twice.
  return (
    <UploadsTable
      rows={rows}
      options={options}
      reconciliation={reconciliation}
      canDelete={can(user, "source_files", "edit")}
      uploadAction={
        can(user, "source_files", "edit") ? <UploadDialog tenantId={user.tenantId} /> : null
      }
    />
  );
}
