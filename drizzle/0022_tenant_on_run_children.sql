-- The two tables hanging off a report run learn which company they belong to.
--
-- Both already belong to one, transitively: a source row points at a run, an
-- artifact points at a run, and the run carries the tenant. Every query
-- reaches them that way and none of them leaks. But "belongs to a company"
-- being a fact about the join rather than about the row means it can only be
-- checked by remembering to join — and a rule the database enforces on the row
-- itself cannot be written against a column that is not there.
--
-- Written by hand rather than as drizzle-kit generated it: the generated form
-- adds the column NOT NULL in one statement, which fails outright on a table
-- that already has rows. Added empty, filled from the run, and only then made
-- required.
ALTER TABLE "report_artifacts" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "report_run_sources" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint

-- The run is the authority here, not a guess: it is where the company was
-- recorded when the report was built.
UPDATE "report_artifacts" AS a
SET "tenant_id" = r."tenant_id"
FROM "report_runs" AS r
WHERE r."id" = a."report_run_id";--> statement-breakpoint

UPDATE "report_run_sources" AS s
SET "tenant_id" = r."tenant_id"
FROM "report_runs" AS r
WHERE r."id" = s."report_run_id";--> statement-breakpoint

-- Both foreign keys are NOT NULL, so every row has a run and every run has a
-- tenant: nothing can be left empty by the two updates above, and this fails
-- loudly rather than quietly if that ever stops being true.
ALTER TABLE "report_artifacts" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "report_run_sources" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "report_artifacts" ADD CONSTRAINT "report_artifacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_run_sources" ADD CONSTRAINT "report_run_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_artifacts_tenant_idx" ON "report_artifacts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_run_sources_tenant_idx" ON "report_run_sources" USING btree ("tenant_id","source_file_id");
