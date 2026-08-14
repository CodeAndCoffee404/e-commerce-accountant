import Decimal from "decimal.js";
import { and, desc, eq, lte } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

/**
 * The ECB publishes reference rates against the euro. The ninety-day feed
 * covers a normal close; the historical one goes back to 1999 and is only
 * needed when an old period is recalculated.
 */
const FEEDS = {
  recent: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml",
  historical: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml",
} as const;

export const FX_BASE = "EUR";

export type FxQuote = {
  rateDate: string;
  base: string;
  quote: string;
  /** Units of `quote` per one `base`. */
  rate: string;
};

/**
 * Parses the ECB's daily XML without an XML library.
 *
 * The document is machine-generated and its shape has not changed in twenty
 * years: `<Cube time="…">` holding `<Cube currency="…" rate="…"/>`. A parser
 * dependency would be several hundred kilobytes to read two attributes.
 */
export function parseEcbFeed(xml: string): FxQuote[] {
  const quotes: FxQuote[] = [];
  const days = xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g);

  for (const [, rateDate, body] of days) {
    for (const [, quote, rate] of body.matchAll(
      /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]\s*\/?>/g,
    )) {
      quotes.push({ rateDate, base: FX_BASE, quote, rate });
    }
  }

  return quotes;
}

export async function fetchEcbRates(feed: keyof typeof FEEDS = "recent"): Promise<FxQuote[]> {
  const response = await fetch(FEEDS[feed], {
    // Reference rates for a past day never change, so a cached copy is as good
    // as a fresh one; the day being published is the only moving part.
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error(`ЕЦБ ответил ${response.status} на запрос курсов.`);
  }

  return parseEcbFeed(await response.text());
}

/** Writes the feed into the cache, leaving already-known days untouched. */
export async function refreshFxRates(feed: keyof typeof FEEDS = "recent"): Promise<number> {
  const quotes = await fetchEcbRates(feed);
  const db = getDb();
  let stored = 0;

  for (let start = 0; start < quotes.length; start += 500) {
    const inserted = await db
      .insert(schema.fxRates)
      .values(
        quotes.slice(start, start + 500).map((quote) => ({
          rateDate: quote.rateDate,
          base: quote.base,
          quote: quote.quote,
          rate: quote.rate,
          source: "ecb",
        })),
      )
      .onConflictDoNothing()
      .returning({ rateDate: schema.fxRates.rateDate });

    stored += inserted.length;
  }

  return stored;
}

export type RateLookup = {
  rate: Decimal;
  rateDate: string;
  source: string;
};

/**
 * The rate to convert `currency` into euro on a given date.
 *
 * The ECB publishes on working days only, so a request for the last day of a
 * month that fell on a Sunday takes the most recent publication before it —
 * which is what a reference rate "as at" a date means. The date actually used
 * is returned, because a report has to record it.
 */
export async function euroRateOn(currency: string, on: string): Promise<RateLookup | null> {
  if (currency === FX_BASE) {
    return { rate: new Decimal(1), rateDate: on, source: "identity" };
  }

  const [row] = await getDb()
    .select({
      rate: schema.fxRates.rate,
      rateDate: schema.fxRates.rateDate,
      source: schema.fxRates.source,
    })
    .from(schema.fxRates)
    .where(
      and(
        eq(schema.fxRates.base, FX_BASE),
        eq(schema.fxRates.quote, currency),
        lte(schema.fxRates.rateDate, on),
      ),
    )
    .orderBy(desc(schema.fxRates.rateDate))
    .limit(1);

  if (!row) return null;

  // The feed quotes currency per euro; converting an amount into euro divides.
  return {
    rate: new Decimal(1).dividedBy(new Decimal(row.rate)),
    rateDate: row.rateDate,
    source: row.source,
  };
}
