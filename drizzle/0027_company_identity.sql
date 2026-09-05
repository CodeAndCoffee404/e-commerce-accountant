-- A company is its id. Its name is only what it is called.
--
-- The short name was a second identifier, unique across companies and derived
-- from the first one, which meant renaming a company left it pointing at what
-- the company used to be — visibly so, since the switcher showed it. Nothing
-- was keyed to it that is not keyed to the id instead, so it goes rather than
-- being kept in step.
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_slug_unique";--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "slug";
