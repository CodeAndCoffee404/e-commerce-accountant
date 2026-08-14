import type { AmazonCountry } from "@/lib/ingest/datasets";

/**
 * Amazon writes this report in the marketplace's language, and in one of two
 * layouts: ES, IT, FR, DE and UK get 29 columns with a separate tax column per
 * charge, while IE, SE, PL, NL and BE get 25 with a single collected-tax
 * column. Position is therefore not stable and cannot be used.
 *
 * Each field lists every name seen across the ten marketplaces. Only one can
 * match a given file, and the names do not collide between languages — `total`,
 * `totaal`, `totalt` and `suma` are distinct strings. One list per field beats
 * ten dictionaries: adding a marketplace is one more string, not a new table.
 */
export const AMAZON_MONTHLY_COLUMNS = {
  quantity: [
    "cantidad",
    "Quantità",
    "quantité",
    "Menge",
    "quantity",
    "antal",
    "ilość",
    "aantal",
  ],

  /** Product sales, excluding tax. */
  sales: [
    "ventas de productos",
    "Vendite",
    "ventes de produits",
    "Umsätze",
    "product sales",
    "försäljning av produkter",
    "sprzedaż produktów",
    "verkoop van producten",
  ],

  /**
   * Tax on the product sale. The 29-column layout names it after the charge;
   * the 25-column one reports a single collected amount instead.
   */
  salesTax: [
    "impuesto de ventas de productos",
    "imposta sulle vendite dei prodotti",
    "Taxes sur la vente des produits",
    "Produktumsatzsteuer",
    "product sales tax",
    "sales tax collected",
    "Inkasserad moms",
    "pobrany podatek od sprzedaży",
    "geïnde omzetbelasting",
    "taxe de ventes prélevée",
  ],

  total: ["total", "totale", "Gesamt", "totalt", "suma", "totaal"],

  status: [
    "Estado de la transacción",
    "Stato della transazione",
    "Statut de la transaction",
    "Transaktionsstatus",
    "Transaction status",
    "Status transakcji",
    "Transactiestatus",
  ],

  fulfilment: [
    "gestión logística",
    "Gestione",
    "traitement",
    "expédition",
    "Versand",
    "fulfilment",
    "fulfillment",
    "leverans",
    "realizacja",
  ],

  description: ["descripción", "Descrizione", "description", "Beschreibung", "beskrivning", "opis", "beschrijving"],
} as const;

/**
 * The report has no currency column — the preamble states it in prose. Each
 * marketplace settles in its own currency, so it follows from the country.
 */
const CURRENCY_BY_COUNTRY: Record<AmazonCountry, string> = {
  ES: "EUR",
  IT: "EUR",
  FR: "EUR",
  DE: "EUR",
  NL: "EUR",
  IE: "EUR",
  BE: "EUR",
  UK: "GBP",
  SE: "SEK",
  PL: "PLN",
};

export function amazonMonthlyCurrency(country: AmazonCountry | null): string | null {
  return country ? CURRENCY_BY_COUNTRY[country] : null;
}

/**
 * Comma is the decimal separator everywhere except the two English-language
 * marketplaces. Verified across the corpus: `-3.541,35` in German,
 * `-254.40` in British.
 */
export function amazonMonthlyDecimalSeparator(country: AmazonCountry | null): "." | "," {
  return country === "UK" || country === "IE" ? "." : ",";
}
