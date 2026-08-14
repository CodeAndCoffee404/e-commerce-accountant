CREATE TYPE "public"."artifact_kind" AS ENUM('xlsx', 'gsheet');--> statement-breakpoint
CREATE TYPE "public"."drive_status" AS ENUM('pending', 'synced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_type" AS ENUM('sales_by_currency', 'off_amazon_sales', 'amazon_zoho_invoice');--> statement-breakpoint
CREATE TABLE "report_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_run_id" uuid NOT NULL,
	"kind" "artifact_kind" NOT NULL,
	"filename" text NOT NULL,
	"blob_key" text,
	"size_bytes" integer,
	"drive_file_id" text,
	"drive_url" text,
	"drive_status" "drive_status",
	"drive_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_run_sources" (
	"report_run_id" uuid NOT NULL,
	"source_file_id" uuid NOT NULL,
	CONSTRAINT "report_run_sources_report_run_id_source_file_id_pk" PRIMARY KEY("report_run_id","source_file_id")
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_type" "report_type" NOT NULL,
	"period_label" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "report_status" DEFAULT 'queued' NOT NULL,
	"requested_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_message" text,
	"rules_snapshot" jsonb,
	"fx_snapshot" jsonb,
	"stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_artifacts" ADD CONSTRAINT "report_artifacts_report_run_id_report_runs_id_fk" FOREIGN KEY ("report_run_id") REFERENCES "public"."report_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_run_sources" ADD CONSTRAINT "report_run_sources_report_run_id_report_runs_id_fk" FOREIGN KEY ("report_run_id") REFERENCES "public"."report_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_run_sources" ADD CONSTRAINT "report_run_sources_source_file_id_source_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."source_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_artifacts_run_idx" ON "report_artifacts" USING btree ("report_run_id");--> statement-breakpoint
CREATE INDEX "report_runs_lookup_idx" ON "report_runs" USING btree ("tenant_id","report_type","period_label","created_at");