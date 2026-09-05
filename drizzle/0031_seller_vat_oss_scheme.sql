-- The one-stop registration stored as a local one.
--
-- 0026 added `scheme` with a default of 'REGULAR' and flipped to 'UNION-OSS'
-- only the row whose note was the literal text 'UNION-OSS'. The note was an
-- editable field at the time, so a company that had ever touched it kept its
-- Estonian registration as REGULAR — invisible to `sellerVatOn`, which matches
-- on the scheme. Since the run began refusing rather than skipping, that is a
-- company that cannot build Off-Amazon Sales at all, and the error tells them
-- to add the number on a screen that has no way to add one.
--
-- Keyed on the number this time, not on a note and not on the country. The
-- number names the one-stop registration itself; a company may well hold a
-- genuine local Estonian registration, and that is a different number.
--
-- The NOT EXISTS leaves alone any company that already has a UNION-OSS row —
-- the unique index on (tenant, country, scheme, valid_from) would refuse a
-- second one anyway, and a company that is already right should not be
-- touched. Running it twice updates nothing the second time.
SELECT set_config('app.bypass_rls', 'on', true);--> statement-breakpoint
UPDATE "seller_vat_numbers" AS s
SET "scheme" = 'UNION-OSS'
WHERE s."scheme" = 'REGULAR'
  AND upper(replace(s."vat_number", ' ', '')) = 'EE102013089'
  AND NOT EXISTS (
    SELECT 1 FROM "seller_vat_numbers" AS o
    WHERE o."tenant_id" = s."tenant_id" AND o."scheme" = 'UNION-OSS'
  );
