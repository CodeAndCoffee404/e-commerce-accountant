-- Which regime a registration is used under.
--
-- The number a report prints is decided by the pair (country, scheme): a
-- company can hold both a local registration and a one-stop one, and the same
-- sale takes one or the other depending on where it went. Until now the
-- numbers were literals inside the channel modules and this table was not read
-- at all, so the scheme had nowhere to live.
--
-- Everything already here is a local registration except the one-stop one,
-- which was seeded with that exact note. Matching on the note rather than on
-- the number keeps this migration true of whatever a company has since edited.
-- The bypass is required: without it the UPDATE touches no rows and says so
-- with a success. See docs/EXTENDING.md.
DROP INDEX "seller_vat_period_idx";--> statement-breakpoint
ALTER TABLE "seller_vat_numbers" ADD COLUMN "scheme" text DEFAULT 'REGULAR' NOT NULL;--> statement-breakpoint
SELECT set_config('app.bypass_rls', 'on', true);--> statement-breakpoint
UPDATE "seller_vat_numbers" SET "scheme" = 'UNION-OSS' WHERE "note" = 'UNION-OSS';--> statement-breakpoint
CREATE UNIQUE INDEX "seller_vat_period_idx" ON "seller_vat_numbers" USING btree ("tenant_id","country","scheme","valid_from");
