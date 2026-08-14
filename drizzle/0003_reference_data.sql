CREATE TABLE "channel_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"rate_date" date NOT NULL,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"source" text DEFAULT 'ecb' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_rate_date_base_quote_pk" PRIMARY KEY("rate_date","base","quote")
);
--> statement-breakpoint
CREATE TABLE "seller_vat_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"country" text NOT NULL,
	"vat_number" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "sku_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"source_sku" text NOT NULL,
	"target_sku" text,
	"item_name" text,
	"is_ignored" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vat_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"country" text NOT NULL,
	"rate" numeric(9, 4) NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "channel_rules" ADD CONSTRAINT "channel_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_vat_numbers" ADD CONSTRAINT "seller_vat_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_mappings" ADD CONSTRAINT "sku_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_rates" ADD CONSTRAINT "vat_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_rules_key_idx" ON "channel_rules" USING btree ("tenant_id","channel","key");--> statement-breakpoint
CREATE INDEX "seller_vat_lookup_idx" ON "seller_vat_numbers" USING btree ("tenant_id","country","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "sku_mappings_source_idx" ON "sku_mappings" USING btree ("tenant_id","channel","source_sku");--> statement-breakpoint
CREATE INDEX "vat_rates_lookup_idx" ON "vat_rates" USING btree ("tenant_id","country","valid_from");