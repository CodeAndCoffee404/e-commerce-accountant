CREATE TYPE "public"."dataset_id" AS ENUM('amazon_vat', 'amazon_monthly', 'allegro', 'cdiscount', 'shopify');--> statement-breakpoint
CREATE TYPE "public"."period_granularity" AS ENUM('month', 'quarter');--> statement-breakpoint
CREATE TYPE "public"."source_file_status" AS ENUM('received', 'classified', 'parsed', 'superseded', 'rejected');--> statement-breakpoint
CREATE TABLE "source_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"blob_key" text NOT NULL,
	"blob_url" text NOT NULL,
	"uploaded_by" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dataset" "dataset_id",
	"dataset_label" text,
	"country_code" text,
	"period_label" text,
	"period_start" date,
	"period_end" date,
	"period_granularity" "period_granularity",
	"header_row_index" integer,
	"detection_meta" jsonb,
	"status" "source_file_status" DEFAULT 'received' NOT NULL,
	"superseded_by_file_id" uuid,
	"reject_code" text,
	"reject_message" text
);
--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_files_sha_idx" ON "source_files" USING btree ("tenant_id","sha256");--> statement-breakpoint
CREATE INDEX "source_files_slice_idx" ON "source_files" USING btree ("tenant_id","dataset","country_code","period_label");--> statement-breakpoint
CREATE INDEX "source_files_uploaded_idx" ON "source_files" USING btree ("tenant_id","uploaded_at");