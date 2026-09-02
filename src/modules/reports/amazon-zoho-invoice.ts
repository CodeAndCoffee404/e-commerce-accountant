import Decimal from "decimal.js";

import { parseDecimalValue } from "@/lib/ingest/numbers";
import { decideSku } from "@/lib/reports/rules";
import type {
  GeneratorResult,
  LedgerRow,
  ReportContext,
  ReportSheet,
  RulesSnapshot,
} from "@/lib/reports/types";

import type { ReportModule } from "./types";

export const ZOHO_HEADERS = [
  "Invoice Date",
  "Invoice Number",
  "Customer Name",
  "Currency Code",
  "Exchange Rate",
  "Item Name",
  "SKU",
  "Item Desc",
  "Quantity",
  "Item Price",
  "Account",
] as const;

/** The ten marketplaces, in the order legacy writes them into the invoice. */
export const ZOHO_COUNTRIES = ["ES", "IT", "FR", "DE", "UK", "SE", "PL", "NL", "IE", "BE"] as const;

/**
 * What a plain order is called in each marketplace's language. Only these rows
 * are invoiced — refunds, fees and transfers are not sales.
 */
const ORDER_TYPES: Record<string, string> = {
  ES: "Pedido",
  IT: "Ordine",
  FR: "Commande",
  DE: "Bestellung",
  UK: "Order",
  SE: "Order",
  PL: "Zamówienie",
  NL: "Bestelling",
  IE: "Order",
  BE: "Commande",
};

const CURRENCIES: Record<string, string> = { PL: "PLN", UK: "GBP", SE: "SEK" };

function currencyOf(country: string): string {
  return CURRENCIES[country] ?? "EUR";
}

/** Amazon's MARKETPLACE column, as it appears in the VAT transaction report. */
const MARKETPLACE_COUNTRIES: Record<string, string> = {
  "amazon.de": "DE",
  "amazon.es": "ES",
  "amazon.fr": "FR",
  "amazon.it": "IT",
  "amazon.pl": "PL",
  "amazon.se": "SE",
  "amazon.nl": "NL",
  "amazon.ie": "IE",
  "amazon.com.be": "BE",
  "amazon.co.uk": "UK",
};

/**
 * Monaco files under France: it is French VAT territory, and there is no
 * Monegasque invoice for the tax to land on. Applied to both schemes, so one
 * country never means two different things on one sheet.
 */
const ARRIVAL_ALIASES: Record<string, string> = { MC: "FR" };

/**
 * Arrival countries big enough for a Zoho ledger line of their own. Everything
 * else pools into "VAT OSS Other countries" — a fixed list by agreement, not a
 * setting: it does not grow on its own because a new country turned up in a
 * file. The same idea, and mostly the same list, as the Shopify invoice.
 */
const OSS_BREAKOUT_COUNTRIES = ["ES", "IT", "FR", "PL", "CZ", "DE"];

/** The bucket everything outside that list is summed into. */
const OSS_OTHER = "OTHER";

/** An amount is only meaningful with its currency, so it is carried per currency. */
type Money = Map<string, Decimal>;

function addMoney(into: Money, currency: string, value: Decimal): void {
  into.set(currency, (into.get(currency) ?? new Decimal(0)).plus(value));
}

type VatTotals = {
  /**
   * REGULAR, by the country the goods arrived in and then by the marketplace
   * that sold them. The country decides which invoice the line belongs to —
   * VAT under the domestic scheme is owed where the sale arrived, whichever
   * marketplace took the order — and the marketplace is kept only to place the
   * line somewhere visible when that country has no invoice of its own.
   */
  regular: Map<string, Map<string, Money>>;
  /**
   * OSS, by the marketplace that sold and then by arrival bucket. The invoice
   * is the marketplace's, and the arrival country splits it into lines: one
   * invoice can carry VAT owed to several countries, which is what OSS is.
   */
  oss: Map<string, Map<string, Money>>;
};

/**
 * Reads the VAT transaction report into the two shapes the invoice needs.
 *
 * Everything comes from the report's own columns — `MARKETPLACE`,
 * `TAX_REPORTING_SCHEME`, `SALE_ARRIVAL_COUNTRY` and the amount — rather than
 * from normalised ledger fields, because those columns are what the rule is
 * written in terms of. Schemes outside REGULAR and UNION-OSS (`UK_VOEC-IMPORT`,
 * `CH_VOEC`) are not invoiced here.
 */
function collectVat(rows: readonly LedgerRow[], warnings: string[]): VatTotals {
  const totals: VatTotals = { regular: new Map(), oss: new Map() };

  for (const row of rows) {
    if (row.dataset !== "amazon_vat") continue;

    const scheme = row.raw.TAX_REPORTING_SCHEME;

    if (scheme !== "REGULAR" && scheme !== "UNION-OSS") continue;

    const value = parseDecimalValue(row.raw.TOTAL_ACTIVITY_VALUE_VAT_AMT, {
      decimalSeparator: ".",
      column: "TOTAL_ACTIVITY_VALUE_VAT_AMT",
    });

    if (!value || value.isZero()) continue;

    const marketplace = MARKETPLACE_COUNTRIES[row.raw.MARKETPLACE ?? ""];
    const currency = row.raw.TRANSACTION_CURRENCY_CODE?.trim() ?? "";
    const raw = row.raw.SALE_ARRIVAL_COUNTRY?.trim() ?? "";
    const arrival = ARRIVAL_ALIASES[raw] ?? raw;

    if (!marketplace) {
      // A marketplace this invoice knows nothing about — `N/A` rows, which
      // carry no VAT in the reports seen so far. Said out loud rather than
      // dropped, because money leaving the sheet has to be visible.
      warnings.push(
        `Amazon VAT: ${value.toFixed(2)} ${currency} under ${scheme} for marketplace ` +
          `"${row.raw.MARKETPLACE ?? ""}", which no invoice covers`,
      );
      continue;
    }

    if (scheme === "REGULAR") {
      const byMarketplace = totals.regular.get(arrival) ?? new Map<string, Money>();
      const money = byMarketplace.get(marketplace) ?? new Map<string, Decimal>();

      addMoney(money, currency, value);
      byMarketplace.set(marketplace, money);
      totals.regular.set(arrival, byMarketplace);

      continue;
    }

    const bucket = OSS_BREAKOUT_COUNTRIES.includes(arrival) ? arrival : OSS_OTHER;
    const byBucket = totals.oss.get(marketplace) ?? new Map<string, Money>();
    const money = byBucket.get(bucket) ?? new Map<string, Decimal>();

    addMoney(money, currency, value);
    byBucket.set(bucket, money);
    totals.oss.set(marketplace, byBucket);
  }

  return totals;
}

/**
 * One invoice line's worth of money, in the currency that invoice is written
 * in. Amounts already in it are added as they are; anything else is converted
 * at the same ECB rate the invoice itself carries.
 *
 * Every marketplace states its VAT in its own currency today, so this is a
 * safety net rather than a routine path — but REGULAR follows the goods rather
 * than the marketplace now, so a Swedish sale arriving in France would put
 * kronor on a euro invoice, and adding those up unconverted would be wrong by
 * a factor of ten.
 */
function inInvoiceCurrency(
  money: Money,
  target: string,
  context: ReportContext,
  note: string,
  warnings: string[],
): Decimal {
  let total = new Decimal(0);

  for (const [currency, amount] of money) {
    if (currency === target || (!currency && target === "EUR")) {
      total = total.plus(amount);
      continue;
    }

    const from = currency === "EUR" ? new Decimal(1) : rateOf(context, currency);
    const to = target === "EUR" ? new Decimal(1) : rateOf(context, target);

    if (!from || !to) {
      warnings.push(
        `${note}: ${amount.toFixed(2)} ${currency} left out — no rate as at ${context.period.end}`,
      );
      continue;
    }

    warnings.push(
      `${note}: ${amount.toFixed(2)} ${currency} converted to ${target} at the ` +
        `${context.period.end} ECB rate`,
    );

    total = total.plus(amount.times(from).dividedBy(to));
  }

  return total;
}

function rateOf(context: ReportContext, currency: string): Decimal | null {
  const rate = context.fx[currency]?.rate;

  return rate ? new Decimal(rate) : null;
}

/** `INV-Amz DE-07.26` — the number the client's accounting expects. */
export function invoiceNumber(country: string, periodEnd: string): string {
  const [year, month] = periodEnd.split("-");

  return `INV-Amz ${country}-${month}.${year.slice(2)}`;
}

type Group = {
  country: string;
  sku: string;
  unitPrice: Decimal;
  quantity: Decimal;
};

/**
 * Amazon invoice for Zoho: ten marketplaces aggregated into invoice lines.
 *
 * Lines are grouped by SKU and unit price, which is where the production bug
 * lived. Legacy computed the unit price with a spreadsheet formula over cells
 * it had written as text, and in the eight comma-decimal marketplaces that
 * produced 0 — so every line grouped under price zero and the invoice went out
 * priced at nothing. Here the division is decimal arithmetic over numbers that
 * were parsed once, at upload.
 */
export function generateZohoInvoice(
  rows: readonly LedgerRow[],
  context: ReportContext,
): GeneratorResult {
  const skipped = new Map<string, number>();
  const warnings: string[] = [];
  const groups = new Map<string, Group>();

  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  for (const row of rows) {
    if (row.dataset !== "amazon_monthly") continue;

    const country = row.countryCode;

    if (!country) {
      skip("Amazon Monthly: row without a country");
      continue;
    }

    const orderType = ORDER_TYPES[country];

    if (row.transactionType !== orderType) {
      skip(`Amazon Monthly ${country}: not an order`);
      continue;
    }

    // Product sales, not the settled total: the invoice bills the goods, and
    // the payout is the goods less Amazon's fees.
    const sales = row.netAmount;

    if (sales === null || sales.toDecimalPlaces(2).isZero()) {
      skip(`Amazon Monthly ${country}: zero product sales`);
      continue;
    }

    const quantity = row.quantity;

    if (quantity === null || quantity.isZero()) {
      skip(`Amazon Monthly ${country}: no quantity`);
      continue;
    }

    const sku = row.sku?.trim();

    if (!sku) {
      skip(`Amazon Monthly ${country}: no SKU`);
      continue;
    }

    const decision = decideSku(context.rules, "amazon", sku);

    if (decision.kind === "ignore") {
      skip(`Amazon Monthly ${country}: SKU is on the ignore list`);
      continue;
    }

    // Grouped by the exact unit price, not the rounded one. Two sales at
    // genuinely different prices are two invoice lines; merging them by their
    // rounded value would move money between lines, and the quantity that
    // carries each price is what the client is billed on.
    const unitPrice = sales.dividedBy(quantity);
    const key = `${country}|${sku}|${unitPrice.toFixed(10)}`;
    const existing = groups.get(key);

    if (existing) existing.quantity = existing.quantity.plus(quantity);
    else groups.set(key, { country, sku, unitPrice, quantity });
  }

  const output: (string | number | null)[][] = [];
  const order = new Map<string, number>(ZOHO_COUNTRIES.map((country, index) => [country, index]));

  const sorted = [...groups.values()].sort((a, b) => {
    const byCountry = (order.get(a.country) ?? 99) - (order.get(b.country) ?? 99);

    return byCountry !== 0 ? byCountry : a.sku.localeCompare(b.sku);
  });

  for (const group of sorted) {
    const currency = currencyOf(group.country);
    const rate = context.fx[currency];

    if (!rate && currency !== "EUR") {
      warnings.push(`No ${currency} rate as at ${context.period.end} — invoice ${group.country}`);
    }

    const decision = decideSku(context.rules, "amazon", group.sku);

    output.push([
      // Invoiced on the last day of the month, whatever day the sale fell on.
      `${context.period.end} 00:00:00`,
      invoiceNumber(group.country, context.period.end),
      `Amazon ${group.country}`,
      currency,
      currency === "EUR" ? "1" : (rate?.rate ?? ""),
      decision.kind === "map" ? decision.itemName : "",
      decision.kind === "map" ? decision.targetSku : group.sku,
      "",
      group.quantity.toFixed(),
      group.unitPrice.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
      `Amazon Sales ${group.country}`,
    ]);
  }

  // VAT is not one line per scheme per marketplace: REGULAR is owed where the
  // goods arrived, whichever marketplace sold them, and OSS stays with the
  // marketplace but splits into the countries it is owed to. Only lines that
  // carry money are printed.
  const invoicedCountries = [...new Set(sorted.map((group) => group.country))].sort(
    (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99),
  );
  const totals = collectVat(rows, warnings);
  const placed = new Set<string>();

  const vatLine = (country: string, label: string, amount: Decimal) => {
    const currency = currencyOf(country);
    const rate = context.fx[currency];

    output.push([
      `${context.period.end} 00:00:00`,
      invoiceNumber(country, context.period.end),
      `Amazon ${country}`,
      currency,
      currency === "EUR" ? "1" : (rate?.rate ?? ""),
      "",
      "",
      label,
      "1",
      amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
      label,
    ]);
  };

  for (const country of invoicedCountries) {
    const currency = currencyOf(country);

    // REGULAR: everything that arrived in this country, from every
    // marketplace, on this country's invoice.
    const arriving = totals.regular.get(country);

    if (arriving) {
      placed.add(country);

      let amount = new Decimal(0);

      for (const [marketplace, money] of arriving) {
        amount = amount.plus(
          inInvoiceCurrency(
            money,
            currency,
            context,
            `VAT ${country} Regular (sold on Amazon ${marketplace})`,
            warnings,
          ),
        );
      }

      if (!amount.toDecimalPlaces(2).isZero()) vatLine(country, `VAT ${country} Regular`, amount);
    }

    // OSS: this marketplace's own, one line per arrival country big enough to
    // have one, the rest together.
    const buckets = totals.oss.get(country);

    if (!buckets) continue;

    for (const bucket of [...OSS_BREAKOUT_COUNTRIES, OSS_OTHER]) {
      const money = buckets.get(bucket);

      if (!money) continue;

      // `VAT FR OSS`, not `VAT OSS FR`: the country sits in the middle and the
      // scheme comes last, because that is the name of the account in Zoho and
      // a line whose name does not match one lands nowhere.
      const label = bucket === OSS_OTHER ? "VAT OSS Other countries" : `VAT ${bucket} OSS`;
      const amount = inInvoiceCurrency(money, currency, context, `${label} on ${country}`, warnings);

      if (!amount.toDecimalPlaces(2).isZero()) vatLine(country, label, amount);
    }
  }

  // REGULAR owed to a country with no invoice of its own — nowhere to file it
  // by the rule above. It stays on the invoice of the marketplace that sold
  // it, named after the country it is owed to, so the money stays visible and
  // whoever files it can see where it belongs.
  for (const [arrival, byMarketplace] of totals.regular) {
    if (placed.has(arrival)) continue;

    for (const [marketplace, money] of byMarketplace) {
      const host = invoicedCountries.includes(marketplace) ? marketplace : null;

      if (!host) {
        warnings.push(
          `VAT ${arrival} Regular: no invoice for the country, and none for Amazon ${marketplace} ` +
            "either — left off the sheet",
        );
        continue;
      }

      const label = `VAT ${arrival} Regular`;
      const amount = inInvoiceCurrency(
        money,
        currencyOf(host),
        context,
        `${label} on ${host}`,
        warnings,
      );

      if (amount.toDecimalPlaces(2).isZero()) continue;

      warnings.push(
        `${label}: ${arrival} has no invoice of its own — billed on Amazon ${host}, where it sold`,
      );
      vatLine(host, label, amount);
    }
  }

  const sheet: ReportSheet = {
    name: "Amazon invoice for Zoho",
    headers: [...ZOHO_HEADERS],
    rows: output,
  };

  return {
    sheets: [sheet],
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
    warnings,
  };
}

/**
 * Which of the ten marketplaces are missing for a period.
 *
 * Legacy refuses to build the invoice unless all ten are present, and that is
 * right: a missing marketplace is not a smaller invoice, it is an invoice that
 * silently omits a country's sales.
 */
export function missingCountries(
  rows: readonly LedgerRow[],
  required: readonly string[] = ZOHO_COUNTRIES,
): string[] {
  const present = new Set(
    rows.filter((row) => row.dataset === "amazon_monthly").map((row) => row.countryCode),
  );

  // Only the marketplaces the tenant still requires. A retired one stops
  // blocking, but its rows are still invoiced whenever they do show up.
  return required.filter((country) => !present.has(country));
}

/**
 * Distinct SKUs this period's Amazon order rows would invoice under that
 * have no row in SKU mapping — an unmapped SKU still reaches the invoice
 * today, under its own raw code, which is exactly what this catches before
 * the fact instead of after.
 *
 * Mirrors `generateZohoInvoice`'s own row filter rather than sharing it: a
 * stricter or looser check here would otherwise risk silently changing what
 * actually gets invoiced.
 */
function unmappedSkus(rows: readonly LedgerRow[], rules: RulesSnapshot): string[] {
  const found = new Set<string>();

  for (const row of rows) {
    if (row.dataset !== "amazon_monthly") continue;

    const country = row.countryCode;

    if (!country || row.transactionType !== ORDER_TYPES[country]) continue;

    const sales = row.netAmount;

    if (sales === null || sales.toDecimalPlaces(2).isZero()) continue;

    const quantity = row.quantity;

    if (quantity === null || quantity.isZero()) continue;

    const sku = row.sku?.trim();

    if (!sku) continue;

    if (decideSku(rules, "amazon", sku).kind === "passthrough") found.add(sku);
  }

  return [...found].sort();
}

export const amazonZohoInvoiceModule: ReportModule = {
  definition: {
    id: "amazon_zoho_invoice",
    label: "Amazon invoice for Zoho",
    // The VAT transaction report joins the ten marketplace files: it is where
    // the tax on these sales is stated, so an invoice issued for a month whose
    // VAT report has not arrived is issued before its own VAT is known — and
    // its two VAT lines per marketplace would price at zero without saying why.
    datasets: ["amazon_monthly", "amazon_vat"],
    // A quarter is refused: the invoice is dated the last day of the month and
    // numbered by month, so a quarter has no meaning here.
    granularity: ["month"],
    // Both files, every month. The ten marketplaces inside Amazon Monthly are
    // a second question the module answers itself, below.
    requiresEveryDataset: true,
    description:
      "Ten marketplaces aggregated into invoice lines for Zoho, with VAT lines from Amazon VAT.",
    needs:
      "Amazon Monthly for all ten marketplaces — ES, IT, FR, DE, UK, SE, PL, NL, IE, BE — " +
      "and the Amazon VAT transaction report for the same month.",
    why:
      "A missing marketplace does not make a smaller invoice. It makes one that leaves a " +
      "country's sales out in silence, and nothing downstream would show it. The VAT " +
      "transaction report is where the tax on these sales is stated: without it the month " +
      "is invoiced before its VAT is known.",
    // Driven by VAT rates and SKU mapping, both checked as reference data
    // rather than as channel rules.
    requiredRules: [],
  },
  // The module's own idea of "all there": every marketplace the tenant still
  // requires. Legacy refuses too, and rightly — a missing marketplace is not a
  // smaller invoice, it is an invoice that omits a country in silence.
  validate(rows, settings) {
    const required = ZOHO_COUNTRIES.filter(
      (country) => settings.countries[country] !== "optional",
    );
    const missing = missingCountries(rows, required);

    return missing.length > 0 ? `Missing Amazon Monthly uploads: ${missing.join(", ")}.` : null;
  },
  unmappedSkus,
  generate: generateZohoInvoice,
};
