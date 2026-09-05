import { eq } from "drizzle-orm";

import { requireTenantId } from "@/lib/db/tenant";
import { getDb, schema } from "@/lib/db";

/** What a company is, as opposed to what it is called. */
export type CompanyIdentity = {
  /** The identifier. Everything a company owns points here, and it never changes. */
  id: string;
  name: string;
  /** Which profile its reports are built from — code, not a setting. */
  profileKey: string;
};

export async function companyIdentity(): Promise<CompanyIdentity | null> {
  const [row] = await getDb()
    .select({
      id: schema.tenants.id,
      name: schema.tenants.name,
      profileKey: schema.tenants.profileKey,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, requireTenantId()))
    .limit(1);

  return row ?? null;
}
