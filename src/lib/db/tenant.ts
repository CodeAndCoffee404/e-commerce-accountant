import { AsyncLocalStorage } from "node:async_hooks";

import { sql } from "drizzle-orm";

import { rootDb, type Executor } from "./index";

/**
 * Which company the work in hand belongs to — told to Postgres, not just to us.
 *
 * Every query in this application is written with `tenant_id` in its `where`.
 * All of them, checked one by one. But that correctness lives in thirty-odd
 * files and in the discipline of everyone who edits them, and a forgotten
 * filter is not a failing test: it is one company's numbers inside another
 * company's report. So the company is named to the database itself, and its
 * row-level security answers a query that did not name one with no rows rather
 * than with somebody else's.
 *
 * The unit is a transaction, and that is forced, not chosen. The connection
 * runs through Neon's pooler, which is PgBouncer in transaction mode: a
 * session-level `SET` would outlive the request and land on whoever borrowed
 * the same server connection next. `set_config(…, true)` is scoped to the
 * transaction and cannot.
 */

type Scope = {
  /**
   * The company, or null in a scope that deliberately spans companies — see
   * `acrossTenants` below for who those are and why.
   */
  tenantId: string | null;
  /** The transaction this scope's queries run on, and which named the company. */
  executor: Executor;
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

/** Where queries should run. Read by `getDb()`, which is how the thirty other files find it. */
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
 * Tells Postgres whose work this is.
 *
 * `true` is the local flag: the setting belongs to this transaction and is
 * gone when it ends. Without it the value would outlive the request on a
 * pooled connection, which is the one way this design could hand somebody
 * another company's rows.
 *
 * Naming a company also puts the bypass back down. The policy reads
 * `tenant_id = … or bypass = 'on'`, so a scope that named a company while the
 * bypass was still up would be labelled as one company and answer for all of
 * them — which is what narrowing into a company inside `acrossTenants` looked
 * like until this line existed.
 */
async function announce(executor: Executor, tenantId: string | null): Promise<void> {
  await executor.execute(
    tenantId === null
      ? sql`select set_config('app.bypass_rls', 'on', true)`
      : sql`select set_config('app.bypass_rls', 'off', true), set_config('app.tenant_id', ${tenantId}, true)`,
  );
}

/**
 * Closes a blocked company's transaction to writes, using Postgres rather than
 * a check somebody has to remember.
 *
 * `transaction_read_only` refuses every INSERT, UPDATE and DELETE for the rest
 * of the transaction, so a page still reads and nothing writes — which is what
 * "closed" means here. One statement, and no way past it: a forgotten guard in
 * one action out of forty would otherwise be invisible until somebody used it.
 *
 * It is one-way. Postgres refuses to put a transaction back into read-write
 * once a query has run, which is why this is only ever done on a transaction
 * this scope opened for itself — see `runScoped`.
 */
async function closeToWrites(executor: Executor, tenantId: string): Promise<void> {
  const blocked = await executor.execute(
    sql`select 1 from tenants where id = ${tenantId}::uuid and blocked_at is not null`,
  );

  if ((blocked as unknown as unknown[]).length > 0) {
    await executor.execute(sql`select set_config('transaction_read_only', 'on', true)`);
  }
}

async function runScoped<T>(tenantId: string | null, fn: () => Promise<T>): Promise<T> {
  const open = currentExecutor();

  // Already inside a transaction this module opened — the nightly job taking
  // one company's turn, or a page whose action re-enters. Re-announce on the
  // same transaction rather than nesting another, and put the announcement
  // back on the way out: the transaction outlives this scope, so leaving it
  // narrowed would silently scope whatever the outer one does next.
  if (open) {
    const outer = storage.getStore()?.tenantId ?? null;

    await announce(open, tenantId);

    try {
      return await storage.run({ tenantId, executor: open }, fn);
    } finally {
      // Best effort: if `fn` threw a database error the transaction is already
      // aborted and this fails too. That direction is safe — the scope stays
      // narrow, and every later statement in an aborted transaction fails
      // anyway. Restoring is what matters when `fn` returned normally.
      await announce(open, outer).catch(() => undefined);
    }
  }

  return rootDb().transaction(async (executor) => {
    await announce(executor, tenantId);

    // Only here, never in the nested branch above. The enclosing transaction
    // there belongs to a caller that deliberately spans companies — signing
    // in, the admin stepping into a company, the nightly job — and read-only
    // cannot be undone once set, so switching it on would leave that caller
    // unable to finish its own work.
    if (tenantId !== null) await closeToWrites(executor, tenantId);

    return storage.run({ tenantId, executor }, fn);
  });
}

/**
 * Runs `fn` as work belonging to one company, in a transaction that says so.
 *
 * Re-entering the same company is fine — a page that checks the session twice
 * should not be a special case. A *different* company is not: nothing in this
 * application legitimately serves two companies in one unit of work, so it is
 * a bug, and one whose symptom would otherwise be a report with a stranger's
 * orders in it.
 */
export function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const current = currentTenantId();

  if (current === tenantId) return fn();
  if (current) throw conflict(current, tenantId);

  return runScoped(tenantId, fn);
}

/**
 * Runs `fn` with no company in scope, on purpose — and with row-level security
 * stood down for the duration.
 *
 * Three kinds of caller, and they are the whole list: signing in and the
 * switcher, which run before anyone knows which company is in play and look a
 * person up by their address across all of them; the work that is genuinely
 * about every company — the nightly job, and the admin screen above them; and
 * tests, which build the rows the others read. Spelling it out is the point —
 * this is the one door around the database's own check, and a door nobody can
 * name is a door nobody guards.
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

  // Already company-less and already in a transaction: nothing to open.
  if (storage.getStore()) return fn();

  return runScoped(null, fn);
}
