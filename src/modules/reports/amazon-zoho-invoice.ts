import Decimal from "decimal.js";

import { decideSku } from "@/lib/reports/rules";
import type { GeneratorResult, LedgerRow, ReportContext, ReportSheet } from "@/lib/reports/types";

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

export const amazonZohoInvoiceModule: ReportModule = {
  definition: {
    id: "amazon_zoho_invoice",
    label: "Amazon invoice for Zoho",
    datasets: ["amazon_monthly"],
    // A quarter is refused: the invoice is dated the last day of the month and
    // numbered by month, so a quarter has no meaning here.
    granularity: ["month"],
    // One dataset, but ten countries — the module checks them itself below.
    requiresEveryDataset: false,
    description: "Ten marketplaces aggregated into invoice lines for Zoho.",
    needs: "Amazon Monthly for all ten marketplaces: ES, IT, FR, DE, UK, SE, PL, NL, IE, BE.",
    why:
      "A missing marketplace does not make a smaller invoice. It makes one that leaves a " +
      "country's sales out in silence, and nothing downstream would show it.",
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
  generate: generateZohoInvoice,
};
