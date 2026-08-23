CREATE TABLE "report_deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_type" "report_type" NOT NULL,
	"granularity" "period_granularity" NOT NULL,
	"deadline_day" integer NOT NULL,
	"deadline_month" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "report_deadlines" ADD CONSTRAINT "report_deadlines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deadlines" ADD CONSTRAINT "report_deadlines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_deadlines_idx" ON "report_deadlines" USING btree ("tenant_id","report_type","granularity");