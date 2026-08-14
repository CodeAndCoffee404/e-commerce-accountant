export type DatasetId =
  | "amazon_vat"
  | "amazon_monthly"
  | "allegro"
  | "cdiscount"
  | "shopify";

export type PeriodResolver =
  | "amazon_vat"
  | "allegro"
  | "cdiscount"
  | "shopify";

export type SimpleDataset = {
  id: Exclude<DatasetId, "amazon_monthly">;
  /** Kept identical to legacy: it is what the report registry matches on. */
  label: string;
  headerRowIndex: number;
  requiredHeaders: readonly string[];
  periodResolver: PeriodResolver;
  periodColumn: string;
  /** Amazon VAT derives its period from AFN rows only. */
  periodFilterColumn?: string;
  periodFilterValue?: string;
};

export const SIMPLE_DATASETS: readonly SimpleDataset[] = [
  {
    id: "amazon_vat",
    label: "Amazon VAT transaction report",
    headerRowIndex: 0,
    requiredHeaders: [
      "UNIQUE_ACCOUNT_IDENTIFIER",
      "ACTIVITY_PERIOD",
      "SALES_CHANNEL",
      "MARKETPLACE",
      "PROGRAM_TYPE",
      "TRANSACTION_TYPE",
    ],
    periodResolver: "amazon_vat",
    periodColumn: "ACTIVITY_PERIOD",
    periodFilterColumn: "SALES_CHANNEL",
    periodFilterValue: "AFN",
  },
  {
    id: "allegro",
    label: "Allegro sales report",
    headerRowIndex: 0,
    requiredHeaders: ["data", "data zaksięgowania", "identyfikator", "operacja", "operator"],
    periodResolver: "allegro",
    periodColumn: "data",
  },
  {
    id: "cdiscount",
    label: "Cdiscount sales report",
    headerRowIndex: 2,
    requiredHeaders: ["Sales channel", "Shop Id", "Invoice/Refund Id", "Accounting date"],
    periodResolver: "cdiscount",
    periodColumn: "Accounting date",
  },
  {
    id: "shopify",
    label: "Geyser shopify sales report",
    headerRowIndex: 0,
    requiredHeaders: [
      "Name",
      "Email",
      "Financial Status",
      "Paid at",
      "Fulfillment Status",
      "Created at",
    ],
    periodResolver: "shopify",
    periodColumn: "Created at",
  },
] as const;

export type AmazonCountry = "ES" | "IT" | "FR" | "DE" | "UK" | "SE" | "PL" | "NL" | "IE" | "BE";

/**
 * Amazon writes the monthly transaction report in the marketplace's language,
 * so the same report has nine different header rows. The profile identifies the
 * layout; the country comes from the marketplace column, because one language
 * can serve several marketplaces — English covers both UK and IE, and the
 * French layout covers FR and BE.
 */
export type AmazonMonthlyProfile = {
  key: string;
  requiredHeaders: readonly string[];
  marketplaceHeader: string;
  /** Used when no row carries a marketplace value; null means "must be read". */
  fallbackCountry: AmazonCountry | null;
  /** Column holding the transaction timestamp, for the period fallback. */
  dateHeader: string;
};

export const AMAZON_MONTHLY_HEADER_SEARCH_ROWS = 20;

export const AMAZON_MONTHLY_PROFILES: readonly AmazonMonthlyProfile[] = [
  {
    key: "ES",
    requiredHeaders: ["fecha y hora", "identificador de pago", "tipo", "número de pedido", "sku"],
    marketplaceHeader: "web de Amazon",
    fallbackCountry: "ES",
    dateHeader: "fecha y hora",
  },
  {
    key: "IT",
    requiredHeaders: ["Data/Ora", "Numero pagamento", "Tipo", "Numero ordine", "SKU"],
    marketplaceHeader: "Marketplace",
    fallbackCountry: "IT",
    dateHeader: "Data/Ora",
  },
  {
    key: "FR",
    requiredHeaders: ["date/heure", "numéro de versement", "type", "numéro de la commande", "sku"],
    marketplaceHeader: "Marketplace",
    fallbackCountry: "FR",
    dateHeader: "date/heure",
  },
  {
    key: "FR_ALT",
    requiredHeaders: [
      "date/heure",
      "Identifiant du paiement",
      "type",
      "Numéro de la commande",
      "SKU",
    ],
    marketplaceHeader: "site de vente",
    fallbackCountry: null,
    dateHeader: "date/heure",
  },
  {
    key: "DE",
    requiredHeaders: ["Datum/Uhrzeit", "Abrechnungsnummer", "Typ", "Bestellnummer", "SKU"],
    marketplaceHeader: "Marketplace",
    fallbackCountry: "DE",
    dateHeader: "Datum/Uhrzeit",
  },
  {
    key: "SE",
    requiredHeaders: ["datum/tid", "reglerings-id", "typ", "beställnings-id", "sku"],
    marketplaceHeader: "marknadsplats",
    fallbackCountry: "SE",
    dateHeader: "datum/tid",
  },
  {
    key: "PL",
    requiredHeaders: [
      "data/godzina",
      "identyfikator rozliczenia",
      "typ",
      "identyfikator zamówienia",
      "sku",
    ],
    marketplaceHeader: "rynek",
    fallbackCountry: "PL",
    dateHeader: "data/godzina",
  },
  {
    key: "NL",
    requiredHeaders: ["datum/tijd", "schikkings-ID", "type", "bestelnummer", "sku"],
    marketplaceHeader: "marketplace",
    fallbackCountry: "NL",
    dateHeader: "datum/tijd",
  },
  {
    key: "EN",
    requiredHeaders: ["date/time", "settlement ID", "type", "order ID", "sku"],
    marketplaceHeader: "marketplace",
    fallbackCountry: null,
    dateHeader: "date/time",
  },
] as const;

export const AMAZON_MARKETPLACE_DOMAINS: Readonly<Record<string, AmazonCountry>> = {
  "amazon.es": "ES",
  "amazon.it": "IT",
  "amazon.fr": "FR",
  "amazon.de": "DE",
  "amazon.co.uk": "UK",
  "amazon.se": "SE",
  "amazon.pl": "PL",
  "amazon.nl": "NL",
  "amazon.ie": "IE",
  "amazon.com.be": "BE",
};

export function amazonMonthlyLabel(country: AmazonCountry): string {
  return `Amazon Monthly Transaction report ${country}`;
}
