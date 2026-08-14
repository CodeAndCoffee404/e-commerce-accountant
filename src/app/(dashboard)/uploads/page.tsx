import { PageHeader } from "@/components/layout/page-header";
import { UploadDropzone } from "@/components/uploads/upload-dropzone";
import { UploadsTable } from "@/components/uploads/uploads-table";
import { requireUser } from "@/lib/auth/session";
import { listUploads } from "@/lib/uploads/queries";

export const metadata = { title: "Uploads — E-commerce Accountant" };

export default async function UploadsPage() {
  const user = await requireUser();
  const rows = await listUploads(user.tenantId);

  return (
    <>
      <PageHeader
        title="Uploads"
        description="Upload raw marketplace exports. Each file is recognised, assigned a period and parsed into transactions."
      />
      <UploadDropzone tenantId={user.tenantId} />
      <UploadsTable rows={rows} />
    </>
  );
}
