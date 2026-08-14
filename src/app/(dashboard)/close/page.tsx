import { PageHeader } from "@/components/layout/page-header";
import { CloseView } from "@/components/close/close-view";
import { UploadDialog } from "@/components/uploads/upload-dialog";
import { requireUser } from "@/lib/auth/session";
import { loadClose } from "@/lib/close/queries";

export const metadata = { title: "Month close — E-commerce Accountant" };

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ClosePage({ searchParams }: PageProps<"/close">) {
  const user = await requireUser();
  const params = await searchParams;
  const data = await loadClose(user.tenantId, one(params.month));

  return (
    <>
      <PageHeader
        title="Month close"
        description="The month at a glance: what is still missing, what can be built, what moved against last month, and what has reached Drive."
        extra={user.role === "viewer" ? undefined : <UploadDialog tenantId={user.tenantId} />}
      />
      <CloseView data={data} canBuild={user.role !== "viewer"} />
    </>
  );
}
