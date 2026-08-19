ALTER TYPE "public"."report_type" ADD VALUE 'custom_slice';--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "variant" text;