#!/usr/bin/env tsx
/**
 * Строит обезличенные копии реальных выгрузок для golden-тестов.
 *
 *   npm run fixtures -- --list
 *   npm run fixtures -- "Allegro sales report - 2026.07 July.csv"
 *   npm run fixtures -- --all
 *
 * Суммы, даты, SKU, коды стран и структура файла сохраняются — иначе фикстура
 * перестаёт проверять расчёты. Заменяются только персональные данные покупателя.
 *
 * Замена детерминированная: одно и то же значение всегда даёт одну и ту же
 * подстановку, поэтому связи «один покупатель — несколько строк» переживают
 * обезличивание, а результат воспроизводим от прогона к прогону.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { classify, type Grid } from "../src/lib/ingest/classify";
import { parseSpreadsheet } from "../src/lib/ingest/parse";


const CORPUS = "docs/legacy-gas/exported-reports";
const OUTPUT = "tests/fixtures";
const OUTPUT_DIRECTORY_SKIP = "Reports";

/**
 * Соль делает подстановки невосстановимыми: без неё хэш короткого значения
 * вроде номера телефона подбирается перебором.
 */
const SALT = "e-commerce-accountant/fixtures/v1";

/**
 * Заголовки, которые выглядят персональными, но таковыми не являются.
 * Проверяются раньше списка ниже: `Lineitem name` — это товар, `Tax 1 Name` —
 * название ставки, а `Name` у Shopify — номер заказа, по которому склеиваются
 * позиции. Подмена любого из них ломает то, что golden-тест и должен проверять.
 */
const NOT_PII_HEADERS = [
  /^name$/i,
  /lineitem\s+name/i,
  /^tax\s*\d*\s*name/i,
  /product/i,
  /item\s+name/i,
  /vendor/i,
  /channel/i,
];

/**
 * Заголовки, которые обезличиваются целиком.
 *
 * Границ слова здесь намеренно нет: первая версия писала `\baddress\b`, и
 * `Billing Address1` мимо неё прошёл — цифра на конце это словесный символ,
 * граница не срабатывает, и реальные адреса покупателей уехали в фикстуру.
 */
const PII_HEADER_PATTERNS = [
  /name/i,
  /email/i,
  /e-mail/i,
  /phone/i,
  /\btel\b/i,
  /address/i,
  /street/i,
  /\bcity\b/i,
  /\bzip/i,
  /postal/i,
  /buyer/i,
  /recipient/i,
  /ship(ping)?[ _-]?to/i,
  /bill(ing)?[ _-]?to/i,
  /company/i,
  /nazwa/i,
  /adres/i,
  /kupując/i,
  /destinataire/i,
  /nombre/i,
  /empfänger/i,
  /miasto/i,
  /ville/i,
];

/**
 * Значения, которые заменяются в любой колонке: заголовки здесь на девяти
 * языках, и полагаться только на их список — значит рано или поздно пропустить
 * колонку.
 *
 * Адрес почты опознаётся однозначно. С телефоном сложнее: шаблон «набор цифр с
 * разделителями» одинаково хорошо описывает `2026-07-01 00:00:00` и номер
 * расчёта Amazon `27014831692`, и первая версия скрипта именно их и портила.
 * Поэтому вне колонок с телефонным заголовком заменяются только номера с явным
 * международным префиксом. Номер без `+` в неожиданной колонке скрипт не
 * увидит — на такой случай список заголовков и расширяется.
 */
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const INTERNATIONAL_PHONE = /\+\d[\d\s()-]{7,17}\d/g;

const FIRST_NAMES = ["Anna", "Piotr", "Marco", "Sophie", "Lars", "Elena", "Tomas", "Nina", "Hugo", "Clara"];
const LAST_NAMES = ["Kowalski", "Rossi", "Dupont", "Meyer", "Andersson", "Novak", "Silva", "Bakker", "Murphy", "Ferrer"];
const STREETS = ["Lindenweg", "Rue des Lilas", "Via Roma", "Calle Mayor", "Kerkstraat", "Ulica Polna", "Storgatan"];
const CITIES = ["Springfield", "Oakvale", "Rivermouth", "Northbrook", "Westhaven", "Elmsford"];

function digest(value: string, scope: string): Buffer {
  return createHash("sha256").update(`${SALT}:${scope}:${value}`).digest();
}

function pick(list: readonly string[], value: string, scope: string): string {
  return list[digest(value, scope).readUInt16BE(0) % list.length];
}

function fakeNumber(value: string, scope: string, digits: number): string {
  const number = digest(value, scope).readUInt32BE(0) % 10 ** digits;

  return String(number).padStart(digits, "0");
}

function fakeEmail(value: string): string {
  const first = pick(FIRST_NAMES, value, "email-first").toLowerCase();
  const last = pick(LAST_NAMES, value, "email-last").toLowerCase();

  // .invalid никогда не резолвится — фикстура не может случайно кому-то написать.
  return `${first}.${last}${fakeNumber(value, "email-n", 3)}@example.invalid`;
}

function fakePhone(value: string): string {
  return `+00 000 ${fakeNumber(value, "phone", 6)}`;
}

function fakeName(value: string): string {
  return `${pick(FIRST_NAMES, value, "first")} ${pick(LAST_NAMES, value, "last")}`;
}

function fakeAddress(value: string): string {
  return `${pick(STREETS, value, "street")} ${(digest(value, "house").readUInt16BE(0) % 200) + 1}`;
}

function replaceHeaderValue(header: string, value: string): string {
  if (value === "") return value;

  const lower = header.toLowerCase();

  if (/email/.test(lower)) return fakeEmail(value);
  if (/phone/.test(lower)) return fakePhone(value);
  if (/address|adres|street/.test(lower)) return fakeAddress(value);
  if (/city|miasto|ville/.test(lower)) return pick(CITIES, value, "city");
  if (/zip|postal/.test(lower)) return fakeNumber(value, "zip", 5);

  return fakeName(value);
}

/** Ловит адреса и телефоны в колонках, о которых мы не подумали. */
function scrubFreeText(value: string): string {
  return value
    .replace(EMAIL, (match) => fakeEmail(match))
    .replace(INTERNATIONAL_PHONE, (match) => fakePhone(match));
}

function piiColumnIndexes(headers: readonly string[]): Set<number> {
  return new Set(
    headers.flatMap((header, index) => {
      const name = header ?? "";

      if (NOT_PII_HEADERS.some((pattern) => pattern.test(name))) return [];

      return PII_HEADER_PATTERNS.some((pattern) => pattern.test(name)) ? [index] : [];
    }),
  );
}

/**
 * Убеждается, что ни одно значение из персональной колонки не доехало до
 * фикстуры. Ошибка в шаблоне заголовка тихо пропускает целую колонку, и
 * заметить это глазами в файле на сотню столбцов невозможно.
 */
function assertNoLeak(
  source: readonly (readonly string[])[],
  result: readonly (readonly string[])[],
  headerRowIndex: number,
  name: string,
): void {
  const headers = source[headerRowIndex] ?? [];
  const columns = piiColumnIndexes(headers);

  for (let rowIndex = headerRowIndex + 1; rowIndex < source.length; rowIndex += 1) {
    for (const columnIndex of columns) {
      const before = source[rowIndex]?.[columnIndex] ?? "";
      const after = result[rowIndex]?.[columnIndex] ?? "";

      if (before !== "" && before === after) {
        throw new Error(
          `${name}: колонка «${headers[columnIndex]}» осталась без изменений в строке ${rowIndex + 1}`,
        );
      }
    }
  }
}

function anonymiseGrid(grid: string[][], headerRowIndex: number): string[][] {
  const headers = grid[headerRowIndex] ?? [];
  const piiColumns = piiColumnIndexes(headers);

  return grid.map((row, rowIndex) => {
    if (rowIndex <= headerRowIndex) return row;

    return row.map((value, columnIndex) => {
      const text = value ?? "";

      if (piiColumns.has(columnIndex)) return replaceHeaderValue(headers[columnIndex] ?? "", text);

      return scrubFreeText(text);
    });
  });
}

function toCsv(grid: Grid, delimiter: string): string {
  const quote = (value: string) =>
    /["\n\r]| /.test(value) || value.includes(delimiter) ? `"${value.replaceAll('"', '""')}"` : value;

  return grid.map((row) => row.map((value) => quote(value ?? "")).join(delimiter)).join("\n");
}

function listCorpus(): string[] {
  const files: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== OUTPUT_DIRECTORY_SKIP) walk(full);
      } else if (/\.(csv|xlsx)$/i.test(entry.name)) {
        files.push(full);
      }
    }
  };

  if (!statSync(CORPUS, { throwIfNoEntry: false })) return files;

  walk(CORPUS);
  return files;
}

const args = process.argv.slice(2);
const corpus = listCorpus();

if (corpus.length === 0) {
  throw new Error(`Нет исходных выгрузок в ${CORPUS} — обезличивать нечего.`);
}

if (args.includes("--list") || args.length === 0) {
  console.log(`Выгрузок в корпусе: ${corpus.length}\n`);
  for (const file of corpus) console.log(`  ${path.basename(file)}`);
  console.log("\nУкажите имя файла или --all.");
  process.exit(0);
}

const wanted = args.includes("--all")
  ? corpus
  : corpus.filter((file) => args.includes(path.basename(file)));

if (wanted.length === 0) {
  throw new Error(`Ни один файл не совпал с ${args.join(", ")}. Список: --list`);
}

mkdirSync(OUTPUT, { recursive: true });

for (const file of wanted) {
  const name = path.basename(file);
  const bytes = readFileSync(file);
  const parsed = await parseSpreadsheet(bytes, name);

  if (!parsed.ok) {
    console.log(`  пропуск  ${name}: ${parsed.code}`);
    continue;
  }

  const before = classify(parsed.grid, name);

  if (!before.ok) {
    console.log(`  пропуск  ${name}: ${before.code}`);
    continue;
  }

  const source = parsed.grid.map((row) => [...row]);
  const grid = anonymiseGrid(source, before.headerRowIndex);

  assertNoLeak(parsed.grid, grid, before.headerRowIndex, name);

  // Фикстура обязана классифицироваться так же, иначе обезличивание задело
  // не только персональные данные.
  const after = classify(grid, name);

  if (!after.ok || after.label !== before.label || after.period.label !== before.period.label) {
    throw new Error(`${name}: после обезличивания классификация изменилась`);
  }

  // Разложено по формату источника: CSV и XLSX одного отчёта дают одинаковое
  // имя, и в одной папке второй молча затирал бы первый.
  const directory = path.join(OUTPUT, `from-${parsed.format}`);

  mkdirSync(directory, { recursive: true });

  const target = path.join(directory, name.replace(/\.xlsx$/i, ".csv"));

  writeFileSync(target, toCsv(grid, parsed.delimiter ?? ","), "utf8");
  console.log(`  готово   from-${parsed.format}/${path.basename(target)}  ${after.label}, ${after.period.label}`);
}
