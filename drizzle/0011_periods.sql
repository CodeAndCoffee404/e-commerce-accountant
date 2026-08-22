CREATE TYPE "public"."period_origin" AS ENUM('schedule', 'upload', 'manual');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"granularity" "period_granularity" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "period_status" DEFAULT 'open' NOT NULL,
	"origin" "period_origin" DEFAULT 'schedule' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text
);
--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "period_id" uuid;--> statement-breakpoint
ALTER TABLE "source_files" ADD COLUMN "period_id" uuid;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "periods_label_idx" ON "periods" USING btree ("tenant_id","label");--> statement-breakpoint
CREATE INDEX "periods_start_idx" ON "periods" USING btree ("tenant_id","start_date");--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Backfill: every period that already exists as a label on a file becomes a
-- row. Origin is 'upload' rather than 'schedule' — these periods exist because
-- a file arrived, which is exactly what that value means, and it keeps the
-- schedule's own record honest once it starts running.
INSERT INTO "periods" ("tenant_id", "label", "granularity", "start_date", "end_date", "origin")
SELECT DISTINCT ON ("tenant_id", "period_label")
  "tenant_id",
  "period_label",
  COALESCE("period_granularity", 'month'::"public"."period_granularity"),
  "period_start",
  "period_end",
  'upload'::"public"."period_origin"
FROM "source_files"
WHERE "period_label" IS NOT NULL
  AND "period_start" IS NOT NULL
  AND "period_end" IS NOT NULL
ORDER BY "tenant_id", "period_label", "uploaded_at"
ON CONFLICT ("tenant_id", "label") DO NOTHING;--> statement-breakpoint
-- A run outlives the files it was built from: deleting an upload does not
-- delete the report that traces to it. So a period may survive only in the
-- register, and it has to come across too or that run points at nothing.
-- Granularity is read back off the label, which is the only place it is left.
INSERT INTO "periods" ("tenant_id", "label", "granularity", "start_date", "end_date", "origin")
SELECT DISTINCT ON ("tenant_id", "period_label")
  "tenant_id",
  "period_label",
  CASE
    WHEN "period_label" ~ '\.Q[1-4]$' THEN 'quarter'::"public"."period_granularity"
    ELSE 'month'::"public"."period_granularity"
  END,
  "period_start",
  "period_end",
  'upload'::"public"."period_origin"
FROM "report_runs"
ORDER BY "tenant_id", "period_label", "created_at"
ON CONFLICT ("tenant_id", "label") DO NOTHING;--> statement-breakpoint
UPDATE "source_files" AS f
SET "period_id" = p."id"
FROM "periods" AS p
WHERE p."tenant_id" = f."tenant_id" AND p."label" = f."period_label";--> statement-breakpoint
UPDATE "report_runs" AS r
SET "period_id" = p."id"
FROM "periods" AS p
WHERE p."tenant_id" = r."tenant_id" AND p."label" = r."period_label";
