#!/usr/bin/env node
/**
 * Applies the environment variables in docs/secrets.local.md to Vercel.
 *
 * That file is gitignored and serves as the backup copy: in Vercel the
 * production and preview values are Sensitive and cannot be read back.
 *
 *   node scripts/vercel-env.mjs --dry-run   show what would happen
 *   node scripts/vercel-env.mjs             apply
 *
 * Requires `npx vercel login`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const SECRETS_FILE = "docs/secrets.local.md";
const ENVIRONMENTS = ["production", "preview", "development"];

/**
 * Names owned by Vercel's own integrations (Neon, Blob).
 *
 * The script reports them and never touches them. The first version deleted
 * them to free the name for the integration, which was right exactly once —
 * before the integrations existed. On the next run the same code removed the
 * real values, and production lost both its connection string and its storage
 * token.
 */
const INTEGRATION_MANAGED = ["DATABASE_URL", "BLOB_READ_WRITE_TOKEN"];

const dryRun = process.argv.includes("--dry-run");

function vercel(args, { input, tolerate = false } = {}) {
  try {
    // --non-interactive, or the CLI waits forever on a prompt when the user is
    // signed out or the project is not linked.
    return execFileSync("npx", ["--yes", "vercel", ...args, "--non-interactive"], {
      input: input ?? "",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (error) {
    if (tolerate) return null;
    process.stderr.write(error.stderr ?? String(error));
    throw new Error(`vercel ${args.join(" ")} failed`);
  }
}

/** Rows of the form `| \`NAME\` | production | \`value\` |`. */
function parseSecrets(markdown) {
  const rows = [];

  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length !== 5) continue;

    const name = cells[1].replaceAll("`", "");
    const environment = cells[2];
    const value = cells[3].replaceAll("`", "");

    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    if (environment !== "all" && !ENVIRONMENTS.includes(environment)) continue;
    // `<…>` marks a value the author still has to fill in.
    if (!value || value.startsWith("<")) continue;

    // `all` for values that are the same everywhere, so one row cannot drift
    // from its siblings.
    const targets = environment === "all" ? ENVIRONMENTS : [environment];

    for (const target of targets) rows.push({ name, environment: target, value });
  }

  return rows;
}

if (!existsSync(SECRETS_FILE)) {
  throw new Error(`${SECRETS_FILE} is missing — there are no values to apply`);
}

// Parsed before any network call: a broken file must stop the script before it
// starts deleting variables in Vercel.
const rows = parseSecrets(readFileSync(SECRETS_FILE, "utf8"));
if (rows.length === 0) {
  throw new Error(`No row in ${SECRETS_FILE} carries a value`);
}

console.log(`Rows parsed: ${rows.length}`);
for (const { name, environment, value } of rows) {
  console.log(`  ${name} → ${environment} (${value.length} characters)`);
}

// A variable is deleted whole before being recreated: Vercel keeps one record
// spanning several environments and gives no way to detach a single one. All
// three therefore have to be listed, or a run would silently leave production
// without a value.
for (const name of new Set(rows.map((row) => row.name))) {
  const missing = ENVIRONMENTS.filter(
    (environment) => !rows.some((row) => row.name === name && row.environment === environment),
  );

  if (missing.length > 0) {
    throw new Error(
      `${name}: ${SECRETS_FILE} has no rows for ${missing.join(", ")}. ` +
        "List every environment, or the run would remove the missing ones.",
    );
  }
}

if (dryRun) {
  console.log("\n--dry-run: nothing was changed.");
  console.log(`Leaving integration-owned variables alone: ${INTEGRATION_MANAGED.join(", ")}`);
  process.exit(0);
}

// The same guard as for environments: the script must not be able to delete
// what it does not own, even if such a name turns up in the secrets table.
for (const name of new Set(rows.map((row) => row.name))) {
  if (INTEGRATION_MANAGED.includes(name)) {
    throw new Error(`${name} is set by a Vercel integration — remove the row from ${SECRETS_FILE}.`);
  }
}

const whoami = vercel(["whoami"], { tolerate: true });
if (whoami === null || /logged out/i.test(whoami)) {
  throw new Error("The Vercel CLI is signed out — run `npx vercel login`");
}
console.log(`\nVercel: ${whoami.trim().split("\n").pop()}`);

if (!existsSync(".vercel/project.json")) {
  console.log("Project not linked, running vercel link…");
  vercel(["link", "--yes"]);
}

console.log("\nCurrent state:\n");
console.log(vercel(["env", "ls"], { tolerate: true }) ?? "(could not be read)");

for (const name of INTEGRATION_MANAGED) {
  console.log(`- ${name}: left alone, an integration owns it`);
}

const names = [...new Set(rows.map((row) => row.name))];

for (const name of names) {
  console.log(`- ${name}: recreating per environment`);
  vercel(["env", "rm", name, "--yes"], { tolerate: true });
}

for (const { name, environment, value } of rows) {
  // Sensitive is wrong for development: such a value is never returned, and
  // `vercel env pull` has to be able to fill the local .env.local.
  const flags = environment === "development" ? ["--no-sensitive"] : ["--sensitive"];
  console.log(`  ${name} → ${environment}`);
  vercel(["env", "add", name, environment, "--force", ...flags], { input: value });
}

console.log("\nResult:\n");
console.log(vercel(["env", "ls"], { tolerate: true }) ?? "(could not be read)");
