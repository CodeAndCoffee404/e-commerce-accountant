-- One person, more than one company.
--
-- The invitation list was unique on the address alone, which encoded an
-- assumption rather than a rule: that one address means one company. It stops
-- being true the moment an accountant keeps the books for two, which is what
-- the company switcher is for. Uniqueness moves to the pair.
--
-- This is the step that costs something to undo. Restoring the old index is a
-- single migration for as long as no address is invited twice; once one is,
-- rebuilding it means deleting one of that person's invitations — taking away
-- access someone is using. Nothing is lost either way, but the choice stops
-- being free.
--
-- `is_super_admin` sits on the person, not on a membership: it is not a role
-- inside a company but the right to see the list of them. Everyone starts
-- false, including the existing owner, and the bootstrap sign-in is what sets
-- the first one — the same lever that created the first tenant.

DROP INDEX "allowed_emails_email_idx";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_super_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "allowed_emails_tenant_email_idx" ON "allowed_emails" USING btree ("tenant_id","email");