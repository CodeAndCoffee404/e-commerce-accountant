-- Which profile a company's reports are built from.
--
-- The key only. The values behind it — where the goods ship from, what counts
-- as a sale, which markets get their own VAT line, what the accounts are
-- called in Zoho — stay in code, because a screen that lets somebody change
-- them is a screen where a warranty replacement quietly becomes revenue.
--
-- The existing company is Geyser, which is what the default says, so this
-- needs no data statement and cannot silently affect zero rows under the
-- row-level security added in 0023.

ALTER TABLE "tenants" ADD COLUMN "profile_key" text DEFAULT 'geyser' NOT NULL;