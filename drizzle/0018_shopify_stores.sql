-- There are two Shopify shops on one account, and their exports have the same
-- columns to the letter: until now both would have been filed as `shopify`
-- and invoiced as one. They become two datasets, told apart by what the file
-- says rather than by its headers.
--
-- Everything already in the database is the European shop's, so it moves
-- there wholesale — dataset, channel rules and SKU mappings alike, the last
-- two because the shops share products and a rule that leaked from one shop
-- to the other would be wrong in a way nothing downstream could notice.
ALTER TABLE "source_files" ALTER COLUMN "dataset" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "dataset" SET DATA TYPE text;--> statement-breakpoint
UPDATE "source_files" SET "dataset" = 'shopify_geyser' WHERE "dataset" = 'shopify';--> statement-breakpoint
UPDATE "transactions" SET "dataset" = 'shopify_geyser' WHERE "dataset" = 'shopify';--> statement-breakpoint
DROP TYPE "public"."dataset_id";--> statement-breakpoint
CREATE TYPE "public"."dataset_id" AS ENUM('amazon_vat', 'amazon_monthly', 'allegro', 'cdiscount', 'cdiscount_orders', 'shopify_geyser', 'shopify_waterlift');--> statement-breakpoint
ALTER TABLE "source_files" ALTER COLUMN "dataset" SET DATA TYPE "public"."dataset_id" USING "dataset"::"public"."dataset_id";--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "dataset" SET DATA TYPE "public"."dataset_id" USING "dataset"::"public"."dataset_id";--> statement-breakpoint
UPDATE "transactions" SET "channel" = 'shopify_geyser' WHERE "channel" = 'shopify';--> statement-breakpoint
UPDATE "channel_rules" SET "channel" = 'shopify_geyser' WHERE "channel" = 'shopify';--> statement-breakpoint
UPDATE "sku_mappings" SET "channel" = 'shopify_geyser' WHERE "channel" = 'shopify';
