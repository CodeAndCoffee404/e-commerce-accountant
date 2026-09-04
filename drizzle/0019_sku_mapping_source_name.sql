-- The item name a source is expected to carry alongside its code, so a
-- mapping can be checked rather than trusted.
--
-- It joins the unique key because a code alone is not always one product:
-- Shopify sells two different items under `QE-5795-1Z7V-stickerless`. Existing
-- rows get the empty name, which is the same key they had, so nothing that
-- matches today stops matching.
DROP INDEX "sku_mappings_source_idx";--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD COLUMN "source_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sku_mappings_source_idx" ON "sku_mappings" USING btree ("tenant_id","channel","source_sku","source_name");
