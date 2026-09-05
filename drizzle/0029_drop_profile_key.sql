-- The column that named a set of rules.
--
-- It was a second identifier for something that already had one: a company is
-- its id, and the values its reports are computed from are found by that id in
-- `src/modules/companies`. Nothing has read this column since the previous
-- deploy, which is the order docs/SETUP.md §1.8 asks for — a column is dropped
-- one deploy after the code stops reading it, because during the switchover the
-- previous version is still answering requests.
ALTER TABLE "tenants" DROP COLUMN "profile_key";
