import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every way into this application has to say which company it is working on.
 *
 * The scope is only worth having if nothing gets in without it, and "nothing"
 * is a property of the whole tree, not of any one file — so it is checked here
 * rather than trusted to review. A new page or route that queries the database
 * without naming a company fails this test on the day it is written, which is
 * the only day it is cheap to fix.
 *
 * Almost every one of them says so the same way: the exported function is a
 * door one line long, `return inRequest(() => …InScope(…))`, and the work sits
 * beside it. The nightly job is the exception, and says `acrossTenants` and
 * `withTenant` outright, because it is the one thing here that really does
 * walk every company.
 *
 * The permission checks are no longer enough on their own. `requireUser` reads
 * the session; it cannot enclose the page that called it, and a transaction
 * has to enclose something.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

/** Calling one of these means the work now runs on a transaction that named a company. */
const ENTERS_SCOPE = [/\binRequest\s*\(/, /\bwithTenant\s*\(/, /\bacrossTenants\s*\(/];

/**
 * The doors that open before anyone knows the company, or that touch no data
 * at all. Each says why, because an unexplained exemption is how a list like
 * this stops meaning anything.
 */
const EXEMPT: Record<string, string> = {
  "src/app/layout.tsx": "the document shell: a theme cookie and fonts, no data",
  "src/app/page.tsx": "redirects to the dashboard and nothing else",
  "src/app/signin/page.tsx": "the sign-in screen, shown before anyone has a company",
  "src/app/select-company/page.tsx":
    "the company chooser: it exists because none has been chosen, and reads only this person's own invitations",
  "src/app/(admin)/layout.tsx":
    "the admin shell: above the companies, so it names none — its guard is requireSuperAdmin",
  "src/app/(admin)/admin/page.tsx":
    "the list of companies: it reads counts and dates through acrossTenants, never a company's rows",
  "src/app/api/auth/[...nextauth]/route.ts": "Auth.js's own handlers; sign-in names the company",
  "src/lib/auth/actions.ts": "starts and ends a session; touches no company data",
};

function walk(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }

  return found;
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/** Pages, layouts and route handlers: everything the framework calls on a request. */
function routeFiles(): string[] {
  return walk(path.join(ROOT, "src/app")).filter((file) =>
    /(^|\/)(page|layout|route)\.tsx?$/.test(relative(file)),
  );
}

/** Server Actions: called straight from the browser, with no route around them. */
function actionFiles(): string[] {
  return walk(path.join(ROOT, "src/lib")).filter(
    (file) => file.endsWith(".ts") && readFileSync(file, "utf8").startsWith('"use server"'),
  );
}

/**
 * The code, without its prose.
 *
 * Comments talk about these functions — the route handlers explain why they
 * name the company themselves rather than through `requireUser` — and a test
 * that reads a mention as a call would pass on a file that does nothing. Only
 * whole-line comments and block comments are removed, so that a `//` inside a
 * URL cannot swallow the code after it.
 */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function namesACompany(file: string): boolean {
  const source = code(file);

  return ENTERS_SCOPE.some((pattern) => pattern.test(source));
}

describe("every way in names a company", () => {
  it("finds the entry points at all", () => {
    // A rename that broke the globbing would otherwise turn this whole file
    // into a test that passes because it checks nothing.
    expect(routeFiles().length).toBeGreaterThan(10);
    expect(actionFiles().length).toBeGreaterThan(8);
  });

  it.each([...routeFiles(), ...actionFiles()].map(relative))("%s", (name) => {
    if (name in EXEMPT) return;

    expect(namesACompany(path.join(ROOT, name)), `${name} runs without naming a company`).toBe(
      true,
    );
  });

  it("keeps the exemption list honest", () => {
    // An exemption for a file that no longer exists is a hole waiting for a
    // file of the same name to be written back into it.
    const present = new Set([...routeFiles(), ...actionFiles()].map(relative));

    for (const name of Object.keys(EXEMPT)) {
      expect(present.has(name), `${name} is exempted but no longer exists`).toBe(true);
    }
  });
});
