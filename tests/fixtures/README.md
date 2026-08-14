# Anonymised fixtures

Copies of the client's real exports with the buyers' personal data removed.
Built by `npm run fixtures` — see `scripts/anonymise-fixtures.mts`.

Kept: amounts, dates, SKUs, product names, order numbers, tax rates, the
structure of the file and the order of its columns. A fixture that loses them
stops testing what it exists to test.

Replaced: names, email addresses, phone numbers, street addresses, cities and
postcodes. Replacement is deterministic, so one buyer stays one buyer across
several rows. Every email address points at `example.invalid`, a domain that
never resolves.

`from-csv/` and `from-xlsx/` split by source format. The same report is often
exported as both, and their contents differ: the XLSX carries dates as date
cells, the CSV as text. Both are needed.

## What is not here

The quarterly Amazon VAT export. It weighs 8.5 MB and would bloat the
repository. Quarter handling is covered by the unit tests in
`src/lib/ingest/period.test.ts`, and on the real file by `tests/corpus.test.ts`,
which runs over the private corpus. If a fixture is ever needed, one command:

```bash
npm run fixtures -- "Amazon VAT transaction report - 2026.Q2.csv"
```
