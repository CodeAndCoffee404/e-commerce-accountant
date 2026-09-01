import { Result } from "antd";

import { requireAccess } from "@/lib/auth/session";

export const metadata = { title: "No access" };

/**
 * Where someone lands when their role has been given no section at all. Not an
 * error: the account is fine, the access is not, and only an owner can change
 * that — so the page says who to ask instead of offering a way back in.
 */
export default async function NoAccessPage() {
  const user = await requireAccess();

  return (
    <Result
      status="403"
      title="Nothing is shared with you yet"
      subTitle={`Your role (${user.role}) has no sections open. An owner can grant access under Settings → Access.`}
    />
  );
}
