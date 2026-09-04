-- Which Shopify orders are sales is no longer a channel rule.
--
-- It has to hold identically in two reports at once — Off-Amazon Sales and the
-- Zoho invoice are one month's money at two grains — and an editable copy of
-- it is a switch that silently lets warranty giveaways and unpaid orders into
-- an invoice. It lives in code now (src/modules/reports/shopify-orders.ts).
--
-- The rows are removed rather than left behind: a rule that still shows in
-- Settings and no longer does anything is worse than no rule at all.
DELETE FROM "channel_rules"
WHERE "channel" = 'shopify_geyser'
  AND "key" IN ('excluded_sources', 'unpaid_payment_methods');
