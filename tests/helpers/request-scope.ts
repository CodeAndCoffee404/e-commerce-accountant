import { acrossTenants } from "@/lib/db/tenant";

/**
 * Runs one test, or one of its hooks, as a unit of work that may touch any
 * company's rows.
 *
 * Two things make this necessary, and both are the design working rather than
 * getting in the way. Postgres now refuses a statement that has not said which
 * company it is for, so a test that builds its own fixtures has to say
 * something — and what it is really doing is what `acrossTenants` exists for:
 * standing rows up for several companies at once, exactly as the nightly job
 * and the sign-in path do. The scope is also a transaction, which a test body
 * has to be inside for its queries to reach the database at all.
 *
 * A second reason, for the tests that call a Server Action: `requireUser`
 * names the company and does not take it back, and a test file is one context
 * for all of its tests, so without a scope of its own each test would inherit
 * the company the last one signed in as.
 *
 * Standing it down applies to the fixtures, not to the action under test: an
 * action calls `inRequest`, which names a company on the same transaction and
 * puts the bypass back down, so what the action itself does runs under the
 * database's check like it does in production. `tests/tenant-isolation.test.ts`
 * proves the check the other way round, from outside any scope.
 */
export function inRequest(body: () => Promise<void>): () => Promise<void> {
  return () => acrossTenants(body);
}
