DROP INDEX "seller_vat_lookup_idx";--> statement-breakpoint
DROP INDEX "vat_rates_lookup_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "seller_vat_period_idx" ON "seller_vat_numbers" USING btree ("tenant_id","country","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "vat_rates_period_idx" ON "vat_rates" USING btree ("tenant_id","country","valid_from");