-- Postgres starts checking whose row is whose.
--
-- Until now the company each query belongs to was in the query's own `where`,
-- in thirty-odd files, kept right by whoever edited them last. From here the
-- database checks it: a statement that has not named a company sees no rows at
-- all, because `current_setting(…, true)` is NULL when unset and NULL is not
-- true. Failing closed is the whole point — the alternative to "no rows" is
-- somebody else's.
--
-- The `nullif` guards a sharp edge: a setting made with `set_config(…, true)`
-- reverts at the end of its transaction to the empty string, not to NULL, once
-- the connection has seen it. Casting '' to uuid raises rather than matching
-- nothing, so without it every query on a reused connection would fail.
--
-- `withTenant` in src/lib/db/tenant.ts names the company once per transaction;
-- `acrossTenants` there sets `app.bypass_rls` and is the one deliberate way
-- past this, for the three places that genuinely span companies: signing in,
-- the nightly job, and the tests that build their rows.

ALTER TABLE "allowed_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "google_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_artifacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_deadlines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_run_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seller_vat_numbers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sku_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "source_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vat_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "allowed_emails" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_log" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "channel_rules" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "google_connections" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "memberships" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "periods" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_artifacts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_deadlines" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_run_sources" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_runs" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "role_permissions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "seller_vat_numbers" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sku_mappings" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "source_files" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transactions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "vat_rates" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.bypass_rls', true) = 'on');


-- Without this the policies above are decorative: the role that owns a table
-- is exempt from its own row-level security unless FORCE says otherwise, and
-- the role the application connects as is exactly that owner. drizzle-kit has
-- no way to express it, so it is written here by hand — and every future table
-- with a company has to remember it, which tests/tenant-isolation.test.ts
-- checks rather than trusting anyone to.

ALTER TABLE "allowed_emails" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "google_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "periods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_artifacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_deadlines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_run_sources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seller_vat_numbers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sku_mappings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "source_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vat_rates" FORCE ROW LEVEL SECURITY;
