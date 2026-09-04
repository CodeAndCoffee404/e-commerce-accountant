import { AsyncLocalStorage } from "node:async_hooks";

import type { Executor } from "./index";

/**
 * Which company the work in hand belongs to.
 *
 * Every query in this application is already written with `tenant_id` in its
 * `where` — all of them, checked one by one. But that correctness lives in
 * thirty-odd files and in the discipline of everyone who edits them, and a
 * forgotten filter is not a failing test, it is one company's numbers inside
 * another company's report. The point of this module is to move that from
 * discipline to structure: the company becomes a property of the request
 * rather than an argument each query has to remember to pass.
 *
 * Today it only records the company and refuses contradictions. What it is
 * built for is the step after: `executor` will carry a transaction that has
 * named the company to Postgres, and row-level security will make a query
 * without one return no rows instead of somebody else's. `getDb()` already
 * prefers that executor, so that step changes this file and not the thirty
 * others.
 */

type Scope = {
  /**
   * The company, or null in a scope that deliberately spans companies — the
   * sign-in path, which has no company yet, and the nightly job, which walks
   * all of them.
   */
  tenantId: string | null;
  /**
   * Where queries in this scope run. Unset for now, which is why nothing
   * changes yet: `getDb()` falls back to the ordinary connection.
   */
  executor?: Executor;
};

const storage = new AsyncLocalStorage<Scope>();

/** The company in hand, or null when there is none — outside a request, or before sign-in. */
export function currentTenantId(): string | null {
  return storage.getStore()?.tenantId ?? null;
}

/**
 * The company in hand, or a thrown error.
 *
 * For code that has no business running without one. Throwing beats defaulting:
 * a default here would be a guess about whose data is being touched.
 */
export function requireTenantId(): string {
  const tenantId = currentTenantId();

  if (!tenantId) {
    throw new Error(
      "No company in scope. Wrap the work in withTenant(), or in acrossTenants() if it really spans companies.",
    );
  }

  return tenantId;
}

/** Where queries should run, when the scope has said. Read by `getDb()`. */
export function currentExecutor(): Executor | undefined {
  return storage.getStore()?.executor;
}

function conflict(current: string, wanted: string): Error {
  return new Error(
    `Already working on company ${current}; cannot switch to ${wanted} in the same scope. ` +
      "Two companies in one unit of work is how their data gets mixed.",
  );
}

/**
 * Runs `fn` as work belonging to one company.
 *
 * Re-entering the same company is fine — a page that checks the session twice
 * should not be a special case. A *different* company is not: nothing in this
 * application legitimately serves two companies in one unit of work, so it is
 * a bug, and one whose symptom would otherwise be a report with a stranger's
 * orders in it.
 */
export function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const current = currentTenantId();

  if (current && current !== tenantId) throw conflict(current, tenantId);

  return storage.run({ tenantId, executor: currentExecutor() }, fn);
}

/**
 * Names the company for the rest of the current request, without wrapping it.
 *
 * The wrapping form cannot reach the places that need this most: `requireUser`
 * returns the signed-in person to a page, it does not enclose the page. Every
 * page and every Server Action already goes through it, so entering the scope
 * there covers all of them at once instead of asking each to remember.
 */
export function enterTenant(tenantId: string): void {
  const current = currentTenantId();

  if (current === tenantId) return;
  if (current) throw conflict(current, tenantId);

  storage.enterWith({ tenantId, executor: currentExecutor() });
}

/**
 * Runs `fn` with no company in scope, on purpose.
 *
 * Three callers, and they are the whole list: signing in, which happens before
 * anyone knows which company the person belongs to; the nightly job, which
 * opens the month for every company in turn; and tests. Spelling it out is the
 * point — when the database starts enforcing the company itself, this is the
 * one door around it, and a door nobody can name is a door nobody guards.
 *
 * It refuses to open inside a company's scope. That direction is the dangerous
 * one: it would widen a request that had been narrowed, which is exactly the
 * shape of a leak.
 */
export function acrossTenants<T>(fn: () => Promise<T>): Promise<T> {
  const current = currentTenantId();

  if (current) {
    throw new Error(
      `Working on company ${current}; acrossTenants() would widen that back out. ` +
        "If this really has to span companies, it does not belong inside a company's request.",
    );
  }

  return storage.run({ tenantId: null }, fn);
}
