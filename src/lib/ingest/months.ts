export type Month = {
  number: number;
  /** Zero-padded, because it goes straight into the period label. */
  numberText: string;
  fullName: string;
  quarter: number;
};

export const MONTHS: readonly Month[] = [
  { number: 1, numberText: "01", fullName: "January", quarter: 1 },
  { number: 2, numberText: "02", fullName: "February", quarter: 1 },
  { number: 3, numberText: "03", fullName: "March", quarter: 1 },
  { number: 4, numberText: "04", fullName: "April", quarter: 2 },
  { number: 5, numberText: "05", fullName: "May", quarter: 2 },
  { number: 6, numberText: "06", fullName: "June", quarter: 2 },
  { number: 7, numberText: "07", fullName: "July", quarter: 3 },
  { number: 8, numberText: "08", fullName: "August", quarter: 3 },
  { number: 9, numberText: "09", fullName: "September", quarter: 3 },
  { number: 10, numberText: "10", fullName: "October", quarter: 4 },
  { number: 11, numberText: "11", fullName: "November", quarter: 4 },
  { number: 12, numberText: "12", fullName: "December", quarter: 4 },
] as const;

export function monthByNumber(monthNumber: number): Month | null {
  return MONTHS.find((month) => month.number === monthNumber) ?? null;
}

/** Three-letter English abbreviation, as Amazon writes it in ACTIVITY_PERIOD. */
export function monthByAbbreviation(abbreviation: string): Month | null {
  const wanted = abbreviation.trim().toUpperCase();

  return MONTHS.find((month) => month.fullName.slice(0, 3).toUpperCase() === wanted) ?? null;
}

/**
 * Month names as they appear inside Amazon Monthly exports, which are written
 * in the marketplace's language. Only needed when the filename has lost its
 * period and the date column is the last thing left to read.
 *
 * Keys are lowercased and stripped of a trailing dot: French abbreviates July
 * as "juil." and May as "mai" in the same file.
 */
const LOCALISED_MONTH_NAMES: Record<string, number> = {};

function registerLocalisedMonths(names: readonly string[][]) {
  for (const [index, variants] of names.entries()) {
    for (const variant of variants) {
      LOCALISED_MONTH_NAMES[variant] = index + 1;
    }
  }
}

registerLocalisedMonths([
  ["jan", "january", "gen", "gennaio", "ene", "enero", "janv", "janvier", "januar", "styczeń", "sty", "januari"],
  ["feb", "february", "febbraio", "fev", "feb", "février", "févr", "februar", "luty", "lut", "februari"],
  ["mar", "march", "mars", "marzo", "märz", "mrz", "marzec", "mar", "maart", "mrt"],
  ["apr", "april", "aprile", "abr", "abril", "avr", "avril", "kwiecień", "kwi"],
  ["may", "maggio", "mag", "mayo", "mai", "maj", "maja", "mei"],
  ["jun", "june", "giugno", "giu", "junio", "juin", "juni", "czerwiec", "cze"],
  ["jul", "july", "luglio", "lug", "julio", "juil", "juillet", "juli", "lipiec", "lip"],
  ["aug", "august", "agosto", "ago", "août", "aout", "augusti", "sierpień", "sie", "augustus"],
  ["sep", "sept", "september", "settembre", "set", "septiembre", "septembre", "wrzesień", "wrz", "syyskuu"],
  ["oct", "october", "ottobre", "ott", "octubre", "octobre", "okt", "oktober", "październik", "paź"],
  ["nov", "november", "novembre", "noviembre", "listopad", "lis"],
  ["dec", "december", "dicembre", "dic", "diciembre", "déc", "decembre", "dezember", "dez", "december", "grudzień", "gru"],
]);

export function monthByLocalisedName(name: string): Month | null {
  const key = name.trim().toLowerCase().replace(/\.$/, "");
  const monthNumber = LOCALISED_MONTH_NAMES[key];

  return monthNumber ? monthByNumber(monthNumber) : null;
}

export function quarterMonths(quarter: number): number[] {
  const first = (quarter - 1) * 3 + 1;

  return [first, first + 1, first + 2];
}
