-- Where Geyser's Shopify goods ship from, and what follows from it, is no
-- longer editable.
--
-- The departure country decided two things at once: the scheme Off-Amazon
-- Sales prints (REGULAR at home, UNION-OSS beyond) and which VAT account the
-- invoice posts to. Only the first read the rule — the invoice spelled the
-- domestic account "VAT ES Regular" outright — so moving the warehouse in
-- Settings would have sent the new country's domestic VAT to Spain's account
-- and said nothing. It lives in code now, and both reads share it.
--
-- Switzerland being out of scope, UK meaning GB, and Britain's wrong zero tax
-- go with it: each is one fact both reports have to agree on, none of them is
-- something a month's close changes.
UPDATE "channel_rules"
SET "value" = "value" - 'departureCountry'
WHERE "channel" = 'shopify_geyser' AND "key" = 'defaults';--> statement-breakpoint

DELETE FROM "channel_rules"
WHERE "channel" = 'shopify_geyser'
  AND "key" IN ('skipped_arrival_countries', 'country_aliases', 'recompute_zero_tax_countries');
