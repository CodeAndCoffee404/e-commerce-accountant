import { asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { MembershipRole } from "@/lib/db/schema";

export type Member = {
  id: string;
  email: string;
  role: MembershipRole;
  isActive: boolean;
  /** Null until the invited person has actually signed in. */
  name: string | null;
  joinedAt: Date | null;
};

/**
 * The access list and the people who have used it, in one view.
 *
 * They are separate tables — an invitation exists before anyone accepts it, and
 * a membership only after a first sign-in — but as a question it is one:
 * who can get in, and who has.
 */
export async function listMembers(tenantId: string): Promise<Member[]> {
  const db = getDb();

  const [invitations, joined] = await Promise.all([
    db
      .select({
        id: schema.allowedEmails.id,
        email: schema.allowedEmails.email,
        role: schema.allowedEmails.role,
        isActive: schema.allowedEmails.isActive,
      })
      .from(schema.allowedEmails)
      .where(eq(schema.allowedEmails.tenantId, tenantId))
      .orderBy(asc(schema.allowedEmails.email)),

    db
      .select({
        email: schema.users.email,
        name: schema.users.name,
        joinedAt: schema.memberships.createdAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.tenantId, tenantId)),
  ]);

  const byEmail = new Map(joined.map((row) => [row.email.toLowerCase(), row]));

  return invitations.map((invitation) => {
    const person = byEmail.get(invitation.email.toLowerCase());

    return {
      ...invitation,
      name: person?.name ?? null,
      joinedAt: person?.joinedAt ?? null,
    };
  });
}
