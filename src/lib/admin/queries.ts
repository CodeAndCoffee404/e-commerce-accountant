import { count, eq, max } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { acrossTenants } from "@/lib/db/tenant";

/**
 * What the admin area knows about the companies.
 *
 * Every question here spans companies by definition — that is what the screen
 * is — so it says `acrossTenants` and stands row-level security down for the
 * length of the read. Kept to counts and dates on purpose: the list is for
 * deciding which company to step into, not for reading anyone's books from
 * outside. Nothing here returns a row of a company's own data.
 */

export type CompanySummary = {
  id: string;
  name: string;
  slug: string;
  /** How many addresses may currently come in — the access list, not arrivals. */
  people: number;
  lastUploadAt: Date | null;
  lastReportAt: Date | null;
};

export async function allCompanies(): Promise<CompanySummary[]> {
  return acrossTenants(async () => {
    const db = getDb();

    const [companies, people, uploads, reports] = await Promise.all([
      db
        .select({ id: schema.tenants.id, name: schema.tenants.name, slug: schema.tenants.slug })
        .from(schema.tenants)
        .orderBy(schema.tenants.name),

      // The access list, not the memberships: "people" on this screen means
      // who may get in, and a membership is only a record that somebody once
      // did. Counting memberships would leave out anyone invited since their
      // last sign-in and count everyone suspended.
      db
        .select({ tenantId: schema.allowedEmails.tenantId, n: count() })
        .from(schema.allowedEmails)
        .where(eq(schema.allowedEmails.isActive, true))
        .groupBy(schema.allowedEmails.tenantId),

      db
        .select({ tenantId: schema.sourceFiles.tenantId, at: max(schema.sourceFiles.uploadedAt) })
        .from(schema.sourceFiles)
        .groupBy(schema.sourceFiles.tenantId),

      db
        .select({ tenantId: schema.reportRuns.tenantId, at: max(schema.reportRuns.createdAt) })
        .from(schema.reportRuns)
        .groupBy(schema.reportRuns.tenantId),
    ]);

    const peopleCount = new Map(people.map((row) => [row.tenantId, row.n]));
    const lastUpload = new Map(uploads.map((row) => [row.tenantId, row.at]));
    const lastReport = new Map(reports.map((row) => [row.tenantId, row.at]));

    return companies.map((company) => ({
      ...company,
      people: peopleCount.get(company.id) ?? 0,
      lastUploadAt: lastUpload.get(company.id) ?? null,
      lastReportAt: lastReport.get(company.id) ?? null,
    }));
  });
}
