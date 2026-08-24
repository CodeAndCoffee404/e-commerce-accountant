-- Custom reports are removed from the product: their definitions, their
-- built runs (and the runs' artifacts/sources, via cascade) and the
-- "custom_slice" report type itself are dropped together so nothing
-- unreachable from the UI is left behind in the database.
DELETE FROM "channel_rules" WHERE "channel" = 'custom_reports';--> statement-breakpoint
DELETE FROM "report_deadlines" WHERE "report_type" = 'custom_slice';--> statement-breakpoint
DELETE FROM "report_runs" WHERE "report_type" = 'custom_slice';--> statement-breakpoint
ALTER TABLE "report_deadlines" ALTER COLUMN "report_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "report_runs" ALTER COLUMN "report_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."report_type";--> statement-breakpoint
CREATE TYPE "public"."report_type" AS ENUM('sales_by_currency', 'off_amazon_sales', 'amazon_zoho_invoice');--> statement-breakpoint
ALTER TABLE "report_deadlines" ALTER COLUMN "report_type" SET DATA TYPE "public"."report_type" USING "report_type"::"public"."report_type";--> statement-breakpoint
ALTER TABLE "report_runs" ALTER COLUMN "report_type" SET DATA TYPE "public"."report_type" USING "report_type"::"public"."report_type";
