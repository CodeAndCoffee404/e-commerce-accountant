import { max } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { acrossTenants } from "@/lib/db/tenant";
import type { MembershipRole } from "@/lib/db/schema";

/**
 * What the admin area knows about the companies.
 *
 * Every question here spans companies by definition — that is what the screen
 * is — so it says `acrossTenants` and stands row-level security down for the
 * length of the read. Kept to counts, dates and the access list on purpose:
 * the screen is for deciding which company to step into and who is in it, not
 * for reading anyone's books from outside. Nothing here returns a row of a
 * company's own data.
 */

export type CompanyPerson = {
  email: string;
  role: MembershipRole;
  /** False when the company's owner has suspended them but not removed them. */
  isActive: boolean;
};

export type CompanySummary = {
  id: string;
  name: string;
  /** When it was closed, or null while it is open. Closed means read-only. */
  blockedAt: Date | null;
  lastUploadAt: Date | null;
  lastReportAt: Date | null;
  /** Everyone on its access list — who may come in, not who has been. */
  people: CompanyPerson[];
};

export async function allCompanies(): Promise<CompanySummary[]> {
  return acrossTenants(async () => {
    const db = getDb();

    const [companies, people, uploads, reports] = await Promise.all([
      db
        .select({
          id: schema.tenants.id,
          name: schema.tenants.name,
          blockedAt: schema.tenants.blockedAt,
        })
        .from(schema.tenants)
        .orderBy(schema.tenants.name),

      // The access list, not the memberships: a membership is only a record
      // that somebody once signed in. Counting those would leave out anyone
      // invited since and include everyone suspended.
      db
        .select({
          tenantId: schema.allowedEmails.tenantId,
          email: schema.allowedEmails.email,
          role: schema.allowedEmails.role,
          isActive: schema.allowedEmails.isActive,
        })
        .from(schema.allowedEmails)
        .orderBy(schema.allowedEmails.email),

      db
        .select({ tenantId: schema.sourceFiles.tenantId, at: max(schema.sourceFiles.uploadedAt) })
        .from(schema.sourceFiles)
        .groupBy(schema.sourceFiles.tenantId),

      db
        .select({ tenantId: schema.reportRuns.tenantId, at: max(schema.reportRuns.createdAt) })
        .from(schema.reportRuns)
        .groupBy(schema.reportRuns.tenantId),
    ]);

    const lastUpload = new Map(uploads.map((row) => [row.tenantId, row.at]));
    const lastReport = new Map(reports.map((row) => [row.tenantId, row.at]));
    const byCompany = new Map<string, CompanyPerson[]>();

    for (const row of people) {
      const list = byCompany.get(row.tenantId) ?? [];

      list.push({ email: row.email, role: row.role, isActive: row.isActive });
      byCompany.set(row.tenantId, list);
    }

    return companies.map((company) => ({
      ...company,
      people: byCompany.get(company.id) ?? [],
      lastUploadAt: lastUpload.get(company.id) ?? null,
      lastReportAt: lastReport.get(company.id) ?? null,
    }));
  });
}
