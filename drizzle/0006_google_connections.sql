CREATE TYPE "public"."google_connection_status" AS ENUM('connected', 'needs_folder', 'revoked', 'error');--> statement-breakpoint
CREATE TABLE "google_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"google_account_email" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"scope" text NOT NULL,
	"root_folder_id" text,
	"root_folder_name" text,
	"status" "google_connection_status" DEFAULT 'needs_folder' NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_by" text
);
--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_tenant_idx" ON "google_connections" USING btree ("tenant_id");