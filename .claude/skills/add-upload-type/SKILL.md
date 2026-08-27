---
name: add-upload-type
description: Adds a new Upload type ("channel module") to this e-commerce accounting app — the workflow for teaching the system to recognise and parse a new marketplace export (a new file layout from Cdiscount, Amazon, Allegro, Shopify, or an entirely new marketplace). Use this whenever the user wants to support a new report/export format, uploads a sample file and asks "can we import this?", says things like "add a new Upload type", "add support for X's export", "this is a different report than the one we already read", or attaches an xlsx/csv from a channel that doesn't classify yet. Also use it as the starting point for questions about how upload/channel classification works in this codebase (src/modules/channels, src/lib/ingest) even if the user hasn't attached a file yet. Do NOT use this to wire an existing dataset into a report generator (src/modules/reports) — that's a separate, explicitly scoped task; this skill covers ingestion only.
---

# Adding a new Upload type

This app calls an upload type a **channel module**. The core (`classify()`,
the uploads pipeline, the transactions ledger) never hardcodes a channel's
name — it iterates a registry of modules and asks each one "is this yours?".
Adding a channel is a new file plus one registry line; nothing that already
works should need to change. If a step below tempts you to edit a file that
isn't in the checklist, stop and re-read `src/modules/channels/registry.ts`'s
own comment — that invariant is the whole point of the architecture.

Follow the steps in order. Steps 0–2 are research; skipping them is the
single biggest source of rework (guessing the header row, or the decimal
separator, wrong costs a full redo).

## Step 0 — Understand the file, not the task description

Get at least one real (or realistic) sample export before writing any code.
Inspect it with the `xlsx` skill or a quick script (`openpyxl`/`markitdown`
for `.xlsx`, a text read for `.csv`) and note:

- **Sheet name and position** — `parseXlsxGrid` in `src/lib/ingest/parse.ts`
  always reads `worksheets[0]`, never by name. If the real export could carry
  the target sheet somewhere other than first, that shared function needs a
  minimal, backward-compatible change (fall back to `[0]`) — flag this to the
  user rather than silently reading the wrong sheet.
- **Header row index** (0-indexed grid row). Most channels put it at row 0;
  Cdiscount's two exports put it below a short preamble (rows 2 and 5). A
  variable/searched header row (Amazon Monthly's multi-language exports) is
  the exception, not the default — see Step 2.
- **A handful of columns that uniquely identify this file** for the
  `requiredHeaders` check — don't require every column, since a renamed or
  added column later would permanently break classification. Pick columns
  unlikely to be renamed and unlikely to collide with a sibling report from
  the same vendor.
- **The date/period column**: format, whether it carries a real time-of-day
  or just a date, and whether every row's date already falls inside one
  calendar month (most exports do — that's what lets a period be derived by
  scanning one column).
- **The decimal separator and currency notation**: `.` or `,`, accounting
  notation for negatives (`(39.99)` = -39.99), a currency symbol glued to the
  number (Allegro's `-24.59 zł`).
- **Whether a "period" is also stated explicitly in a preamble** (e.g.
  Cdiscount's `Period from (UTC)` / `To (UTC)`). Every existing channel
  derives its period by scanning the data rows' date column instead of
  trusting an explicit preamble field — follow that precedent unless you have
  a concrete reason not to (see `classifySimpleChannel` in
  `src/modules/channels/toolkit.ts`).
- **Whether this is a genuinely new channel, or another export from a
  marketplace the system already reads** (like Cdiscount's order extract vs.
  its invoice list). If the latter, the new dataset can share the existing
  channel's `channel_rules` bucket instead of re-declaring defaults — see
  Step 4.

## Step 1 — Choose the three names

Read `src/modules/channels/registry.ts`'s naming comment and match the
existing pattern:

| Thing | Style | Examples | Your new one |
|---|---|---|---|
| `DatasetId` (internal id) | snake_case, vendor_subtype | `allegro`, `cdiscount`, `amazon_monthly` | e.g. `cdiscount_orders` |
| `label` (`SimpleDataset.label`, stored as `datasetLabel`, shown in Uploads) | Sentence case, `"<Vendor> <kind> report"` | `"Cdiscount sales report"`, `"Allegro sales report"` | matches what the user calls it |
| `shortName` (chips/filters) | Short, capitalised vendor name | `"Cdiscount"`, `"Amazon Monthly"` | e.g. `"Cdiscount Orders"` |

Module file name: kebab-case matching the id, e.g. `cdiscount-orders.ts`
(a subdirectory like `amazon-monthly/` is only worth it once the
column-mapping logic itself grows large, e.g. per-marketplace language
tables — don't create one pre-emptively).

## Step 2 — Pick the classification shape

Almost every channel is a **fixed header row** (`SimpleDataset` in
`src/lib/ingest/datasets.ts`, matched via `classifySimpleChannel` in
`src/modules/channels/toolkit.ts`): one `requiredHeaders` check at one known
row, one `periodColumn` scanned for the month. Read `cdiscount.ts`,
`allegro.ts`, `amazon-vat.ts`, or `shopify.ts` as your template — they're
nearly identical in shape, and the differences between them are exactly the
differences your new module will have (which columns, which date format,
whether the mapper needs running state across rows like Shopify's
order-header carry-down).

Reach for a **hand-rolled classifier** (`amazon-monthly/module.ts` is the
example — `classify` is a plain function, not `classifySimpleChannel`) only
when the header row genuinely isn't fixed — e.g. it depends on which
language the export was generated in and has to be searched for among the
first N rows. This is meaningfully more code and a new failure mode (get the
search wrong and it silently matches the wrong row); don't reach for it out
of caution when a fixed row will do. If in doubt, Step 0's inspection should
already have told you which case you're in.

## Step 3 — The files, in dependency order

Each of these is small and mechanical once Steps 0–2 are settled. In order,
because later files reference names introduced by earlier ones:

1. **`src/lib/ingest/datasets.ts`** — add the new id to `DatasetId`. If the
   date format needs its own parser (see Step 4), also add it to
   `PeriodResolver`. `SimpleDataset["id"]` excludes only `"amazon_monthly"`,
   so nothing else here needs touching for the common case.
2. **`src/lib/db/schema.ts`** — add the same id to the `datasetId` pgEnum
   (`dataset_id` in Postgres), same order/style as `DatasetId`.
3. **`src/lib/ingest/period.ts`** (only if the date format is new) — add a
   parser function next to its siblings (`parseCdiscountDate`,
   `parseAllegroDate`, …). Keep it strict and anchored (`^...$`) for one
   exact format — a loose parser that guesses is how a transaction lands in
   the wrong month. Doc-comment the exact string shape it expects, ideally
   with a real example value from Step 0.
4. **`src/modules/channels/toolkit.ts`** — add the new resolver to the
   `DATE_PARSERS` map. This `Record` is exhaustive over
   `SimpleDataset["periodResolver"]`, so the compiler will refuse to build
   until this is done — a useful forcing function, not a formality.
5. **`src/modules/channels/<new-file>.ts`** — the module itself: the mapper
   function, the `PROFILE: SimpleDataset` (or custom classify), and the
   exported `ChannelModule`. See Step 4 for mapper field guidance.
6. **`src/modules/channels/registry.ts`** — import the module and add it to
   `CHANNEL_MODULES`. Order only matters relative to a module that searches a
   variable header row (Amazon Monthly goes first, per its own comment) or
   that could plausibly match the same fixed row as another module — for a
   normal fixed-row channel, placement anywhere is safe; put it next to a
   sibling from the same vendor for readability.
7. **`src/components/transactions/transactions-view.tsx`** — add an entry to
   `DATASET_LABELS` so the transactions filter/chip shows a proper name
   instead of the raw id (it falls back gracefully, but do this anyway).

## Step 4 — Writing the mapper

`MappedTransaction` (`src/lib/ingest/mappers/types.ts`) is the shape every
mapper produces. Use `RowReader` and `Attention`
(`src/lib/ingest/mappers/reader.ts`) exactly as the existing mappers do:

- Construct `new RowReader(grid, headerRowIndex, decimalSeparator)` once.
- Loop `reader.firstDataRow` to `reader.rowCount`, skip `reader.isBlank(row)`.
- Read amounts with `reader.decimal(row, "Column")` through an `Attention`
  instance (`attention.take(...)`) so one bad cell flags its row instead of
  aborting the file. Never fall back to zero for something that failed to
  parse — that's the specific bug this architecture exists to prevent (see
  the doc-comment on `parseDecimalValue`).
- Run `wholeUnitsProblem(quantity, "Column")` through `attention.add(...)`
  whenever quantity is supposed to be whole units (almost always).
- Build `naturalKey` from whatever combination of columns is actually unique
  per row in this file — check by eye against a real sample, since a wrong
  guess here doesn't fail loudly, it just silently mis-supersedes future
  uploads.
- Normalise country codes to upper-case if the file writes them any other
  way (e.g. Cdiscount's `Fr`) — every other channel stores upper-case, and a
  stray lower-case value quietly creates a second bucket wherever
  transactions get grouped by country.
- If this dataset is another export from a marketplace already read by an
  existing module (Cdiscount orders vs. Cdiscount invoices; compare how both
  Amazon modules use `channel: "amazon"` despite different `dataset` ids),
  set the same `channel` string and leave `defaultRules: []` on the new
  module — the sibling module already seeds that channel's rules, and a
  second seed for the same `(channel, key)` would just duplicate the row.
- Store only what the file actually says. Don't compute a field the mapper
  has no real source for (e.g. don't split a combined total into net/VAT
  without a column that says how) — leave it `null` and let a future report
  module compute it from `raw` if it ever needs to. `raw: reader.raw(rowIndex)`
  already keeps every column verbatim, so nothing is lost by leaving a typed
  field empty.

## Step 5 — Generate the DB migration

Don't hand-write the SQL. From the repo root:

```bash
DATABASE_URL="postgres://user:pass@localhost:5432/db" npm run db:generate
```

`drizzle-kit generate` only diffs the schema file against its stored
snapshots — it never actually connects, but `drizzle.config.ts` requires
*some* value in one of the DB env vars to parse, so a placeholder is enough
in a sandbox with no real database configured. This produces
`drizzle/<NNNN>_<random-name>.sql` and a matching
`drizzle/meta/<NNNN>_snapshot.json`, and appends an entry to
`drizzle/meta/_journal.json`.

Rename the migration file to something descriptive, matching the existing
convention (see `drizzle/0014_allegro_zoho_invoice_report_type.sql`):

```bash
mv drizzle/<NNNN>_<random-name>.sql drizzle/<NNNN>_<descriptive_name>.sql
```

Then edit the `"tag"` field for that entry in `drizzle/meta/_journal.json` to
match the renamed file — the snapshot file's own name can stay as generated,
only the journal tag and the `.sql` filename need to agree.

## Step 6 — Build an anonymised test fixture

Never commit a real export as-is — it carries buyer names, emails, phones,
and addresses. `scripts/anonymise-fixtures.mts` already does the right
thing (deterministic replacement so one buyer stays one buyer across rows,
kept: amounts/dates/SKUs/structure; replaced: anything that looks personal),
but it only reads from `docs/legacy-gas/exported-reports/` (gitignored, the
private corpus — usually absent outside the maintainer's machine).

To anonymise an ad-hoc sample file instead:

1. Copy the sample into a scratch directory, renamed to the fixture
   convention the output depends on: `<label> - <period>.<ext>` (e.g.
   `Cdiscount orders report - 2026.05 May.xlsx`) — the anonymiser reuses the
   *input* basename for the output, so the input must already be named
   correctly.
2. Copy `scripts/anonymise-fixtures.mts` to a scratch file (don't edit the
   real one) and point its `CORPUS` constant at the scratch directory instead
   of `docs/legacy-gas/exported-reports`.
3. Run it with `npx tsx <scratch-script> --all`. It classifies the file with
   your new module (proving Steps 0–4 actually work end-to-end), anonymises
   every PII-looking column, asserts nothing personal leaked, re-classifies
   the anonymised grid to confirm the label/period didn't change, and writes
   `tests/fixtures/from-<format>/<label> - <period>.csv`.
4. Delete the scratch script and scratch directory. Only the output CSV
   under `tests/fixtures/` should end up committed.

If several sample files are available, prefer one with a bit of variety
(more than one status/type value) over the cleanest one — it exercises more
of the mapper for free.

## Step 7 — Update the fixture coverage test

`tests/fixtures.test.ts` hardcodes the list of labels its "cover every
channel" test expects (`covered` vs `expected`). Add the new report's
`label` to that array, or the whole suite fails on an otherwise-correct
fixture.

## Step 8 — Validate before calling it done

```bash
npx tsc --noEmit -p tsconfig.json   # no new errors vs. what main already has
npx eslint .
npx vitest run tests/fixtures.test.ts tests/mappers.test.ts tests/corpus.test.ts
npx vitest run                      # full suite
```

`tests/mappers.test.ts` auto-discovers every fixture and asserts
`missingColumns` is empty, at least one row came through, and no row is
flagged `needsAttention` — a real bug in the mapper shows up here without a
dedicated test. `tests/corpus.test.ts` runs the same checks against the
private corpus and self-skips where that directory doesn't exist (e.g. this
sandbox) — don't treat a skip as a pass if the maintainer's machine has the
corpus.

If any test fails and you're unsure whether it's pre-existing, check
`main`/HEAD before your change (`git stash`, rerun, `git stash pop`) rather
than assuming — this codebase's sandbox has no live Postgres connection, so
a handful of DB-dependent test files fail identically with or without your
change; that's expected, not something to fix.

## Step 9 — Stay in scope

Adding an Upload type does **not** require wiring the new dataset into any
report generator (`src/modules/reports/*`). Every report explicitly lists
the datasets it consumes (`ReportDefinition.datasets`) — a brand-new dataset
simply doesn't appear in any report until a report module is changed to ask
for it, which is normal and doesn't need any action here. Only touch
`src/modules/reports/` if the user explicitly asks for the new data to feed
a specific report; that's a separate, larger task with its own review of
what the report's arithmetic should do with the new rows.
