import Decimal from "decimal.js";

export type DecimalSeparator = "." | ",";

export class NumberFormatError extends Error {
  constructor(
    readonly raw: string,
    readonly column: string,
  ) {
    super(`Value "${raw}" in column "${column}" is not a number.`);
    this.name = "NumberFormatError";
  }
}

/**
 * Every space a spreadsheet might use as a thousands separator: ordinary,
 * non-breaking, narrow non-breaking, thin.
 */
const SPACES = /[\s   ]/g;

/**
 * Currency written next to the amount rather than in its own column. Allegro
 * settles in five: `-24.59 zł`, `-1211.38 Ft`, `208 Kč`, euro and the codes.
 */
const CURRENCY = /(zł|Kč|Ft|kr|€|£|\$|EUR|PLN|SEK|GBP|USD|CZK|HUF|RON|DKK)/gi;

/**
 * Amazon does not always write a plain hyphen. The Swedish export uses U+2212
 * MINUS SIGN and the VAT report an en dash. Normalising first means the sign
 * logic below only ever sees one character.
 */
const MINUS_LIKE = /[−–—]/g;

/**
 * Parses one cell into an exact decimal.
 *
 * The separator is passed in rather than guessed. Guessing is what the legacy
 * code did, and `1,234` is genuinely ambiguous — 1234 in one locale, 1.234 in
 * another. The channel and its locale are already known by the time a row is
 * mapped, so there is nothing to guess about.
 *
 * Never returns zero for input it did not understand. The production bug this
 * replaces did exactly that: a spreadsheet formula divided by a text cell,
 * produced 0, and fifty invoice lines went out priced at nothing.
 */
export function parseDecimalValue(
  raw: string | null | undefined,
  options: { decimalSeparator: DecimalSeparator; column: string },
): Decimal | null {
  const text = (raw ?? "").trim().replace(MINUS_LIKE, "-");

  // A lone dash is how these exports write "nothing here", not minus zero.
  if (text === "" || text === "-") return null;

  let normalised = text.replace(CURRENCY, "").replace(SPACES, "");

  // Accounting notation: (29.90) is minus 29.90. Legacy stripped the brackets
  // and kept the value positive, which flipped the sign of every Cdiscount
  // refund. See the agreed rule: refunds are negative in every channel.
  let negative = false;

  if (/^\((.*)\)$/.test(normalised)) {
    negative = true;
    normalised = normalised.slice(1, -1);
  }

  if (normalised.startsWith("-")) {
    negative = !negative;
    normalised = normalised.slice(1);
  } else if (normalised.startsWith("+")) {
    normalised = normalised.slice(1);
  }

  normalised =
    options.decimalSeparator === ","
      ? normalised.replace(/\./g, "").replace(",", ".")
      : normalised.replace(/,/g, "");

  if (!/^\d+(\.\d+)?$/.test(normalised)) {
    throw new NumberFormatError(text, options.column);
  }

  const value = new Decimal(normalised);

  return negative ? value.negated() : value;
}

/** Same rules, but a missing value counts as zero. */
export function parseDecimalOrZero(
  raw: string | null | undefined,
  options: { decimalSeparator: DecimalSeparator; column: string },
): Decimal {
  return parseDecimalValue(raw, options) ?? new Decimal(0);
}

/**
 * Quantities are whole units in every channel, so a fractional one means the
 * column was misread rather than that someone sold half a filter.
 */
export function parseQuantity(
  raw: string | null | undefined,
  options: { decimalSeparator: DecimalSeparator; column: string },
): number | null {
  const value = parseDecimalValue(raw, options);

  if (value === null) return null;
  if (!value.isInteger()) throw new NumberFormatError((raw ?? "").trim(), options.column);

  return value.toNumber();
}

/** The string form Postgres `numeric` accepts without going through a float. */
export function toNumeric(value: Decimal | null): string | null {
  return value === null ? null : value.toFixed();
}
