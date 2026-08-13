#!/usr/bin/env node
/**
 * Раскладывает переменные окружения по Vercel из docs/secrets.local.md.
 *
 * Файл с секретами в .gitignore и является резервной копией: в Vercel
 * production- и preview-значения помечены Sensitive и обратно не читаются.
 *
 *   node scripts/vercel-env.mjs --dry-run   показать, что будет сделано
 *   node scripts/vercel-env.mjs             применить
 *
 * Требует `npx vercel login`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const SECRETS_FILE = "docs/secrets.local.md";
const ENVIRONMENTS = ["production", "preview", "development"];

/**
 * Имена, которые заводят интеграции Vercel (Neon, Blob). Заведённая руками
 * копия занимает имя, из-за чего интеграция не может подключиться, и живёт
 * своей жизнью после смены пароля в Neon.
 */
const INTEGRATION_MANAGED = ["DATABASE_URL", "BLOB_READ_WRITE_TOKEN"];

const dryRun = process.argv.includes("--dry-run");

function vercel(args, { input, tolerate = false } = {}) {
  try {
    // --non-interactive, иначе при разлогине или непривязанном проекте CLI
    // уходит в бесконечное ожидание ответа на приглашение.
    return execFileSync("npx", ["--yes", "vercel", ...args, "--non-interactive"], {
      input: input ?? "",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (error) {
    if (tolerate) return null;
    process.stderr.write(error.stderr ?? String(error));
    throw new Error(`vercel ${args.join(" ")} — не удалось`);
  }
}

/** Строки вида `| \`NAME\` | production | \`value\` |`. */
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
  throw new Error(`Нет ${SECRETS_FILE} — брать значения неоткуда`);
}

// Разбор до любых сетевых вызовов: испорченный файл должен ронять скрипт
// раньше, чем он начнёт удалять переменные в Vercel.
const rows = parseSecrets(readFileSync(SECRETS_FILE, "utf8"));
if (rows.length === 0) {
  throw new Error(`В ${SECRETS_FILE} не нашлось ни одной строки со значением`);
}

console.log(`Разобрано строк: ${rows.length}`);
for (const { name, environment, value } of rows) {
  console.log(`  ${name} → ${environment} (${value.length} символов)`);
}

// Переменная удаляется целиком перед пересозданием: Vercel хранит одну запись
// на несколько окружений, и выборочно снять с неё одно окружение нельзя.
// Значит, в таблице должны быть все три — иначе прогон молча оставит
// production без значения.
for (const name of new Set(rows.map((row) => row.name))) {
  const missing = ENVIRONMENTS.filter(
    (environment) => !rows.some((row) => row.name === name && row.environment === environment),
  );

  if (missing.length > 0) {
    throw new Error(
      `${name}: в ${SECRETS_FILE} нет строк для ${missing.join(", ")}. ` +
        "Перечислите все окружения, иначе прогон снесёт недостающие.",
    );
  }
}

if (dryRun) {
  console.log("\n--dry-run: ничего не меняю.");
  console.log(`Будут удалены ручные копии: ${INTEGRATION_MANAGED.join(", ")}`);
  process.exit(0);
}

const whoami = vercel(["whoami"], { tolerate: true });
if (whoami === null || /logged out/i.test(whoami)) {
  throw new Error("Vercel CLI разлогинен — выполните `npx vercel login`");
}
console.log(`\nVercel: ${whoami.trim().split("\n").pop()}`);

if (!existsSync(".vercel/project.json")) {
  console.log("Проект не привязан, выполняю vercel link…");
  vercel(["link", "--yes"]);
}

console.log("\nТекущее состояние:\n");
console.log(vercel(["env", "ls"], { tolerate: true }) ?? "(не удалось прочитать)");

for (const name of INTEGRATION_MANAGED) {
  console.log(`- ${name}: удаляю ручную копию, значение придёт из интеграции`);
  vercel(["env", "rm", name, "--yes"], { tolerate: true });
}

const names = [...new Set(rows.map((row) => row.name))];

for (const name of names) {
  console.log(`- ${name}: пересоздаю по окружениям`);
  vercel(["env", "rm", name, "--yes"], { tolerate: true });
}

for (const { name, environment, value } of rows) {
  // Sensitive нельзя ставить на development: такое значение не отдаётся
  // обратно, а `vercel env pull` должен наполнять локальный .env.local.
  const flags = environment === "development" ? ["--no-sensitive"] : ["--sensitive"];
  console.log(`  ${name} → ${environment}`);
  vercel(["env", "add", name, environment, "--force", ...flags], { input: value });
}

console.log("\nИтог:\n");
console.log(vercel(["env", "ls"], { tolerate: true }) ?? "(не удалось прочитать)");
