CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_file_id" uuid NOT NULL,
	"source_row_number" integer NOT NULL,
	"dataset" "dataset_id" NOT NULL,
	"channel" text NOT NULL,
	"country_code" text,
	"period_label" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"natural_key" text,
	"occurred_on" date,
	"transaction_type" text,
	"currency" text,
	"gross" numeric(18, 6),
	"vat_amount" numeric(18, 6),
	"net_amount" numeric(18, 6),
	"vat_rate" numeric(9, 6),
	"departure_country" text,
	"arrival_country" text,
	"seller_vat_number" text,
	"buyer_vat_number" text,
	"tax_scheme" text,
	"sku" text,
	"quantity" numeric(18, 6),
	"needs_attention" boolean DEFAULT false NOT NULL,
	"attention_reason" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_source_file_id_source_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."source_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_slice_idx" ON "transactions" USING btree ("tenant_id","dataset","country_code","period_start","is_current");--> statement-breakpoint
CREATE INDEX "transactions_natural_key_idx" ON "transactions" USING btree ("tenant_id","natural_key");--> statement-breakpoint
CREATE INDEX "transactions_file_idx" ON "transactions" USING btree ("source_file_id");