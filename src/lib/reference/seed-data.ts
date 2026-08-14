/**
 * The rules the legacy scripts had hard-coded, lifted verbatim so a first run
 * reproduces its output. From here on they are rows in the database and are
 * edited in the interface — changing a VAT rate must not need a developer.
 *
 * Sources: ANALYSIS.md §5.2 for the channel rules,
 * Report_AmazonInvoiceForZoho_config.gs for the SKU tables.
 */

/** Long enough ago to cover every period the client can upload. */
export const RULES_EFFECTIVE_FROM = "2020-01-01";

export const VAT_RATES: readonly { country: string; rate: string; note?: string }[] = [
  { country: "PL", rate: "23", note: "Allegro, продажи в злотых" },
  { country: "CZ", rate: "21", note: "Allegro, продажи в кронах" },
  { country: "SK", rate: "20", note: "Allegro, продажи в евро — согласованное допущение" },
  { country: "HU", rate: "27", note: "Allegro, продажи в форинтах" },
  { country: "FR", rate: "20", note: "Cdiscount" },
  { country: "ES", rate: "21" },
  { country: "DE", rate: "19" },
  { country: "IT", rate: "22" },
  { country: "NL", rate: "21" },
  { country: "BE", rate: "21" },
  { country: "IE", rate: "23" },
  { country: "SE", rate: "25" },
  { country: "GB", rate: "20", note: "Shopify: при отсутствии ставки в файле берётся эта" },
];

export const SELLER_VAT_NUMBERS: readonly {
  country: string;
  vatNumber: string;
  note?: string;
}[] = [
  { country: "PL", vatNumber: "PL5263307678", note: "Allegro, схема REGULAR" },
  { country: "EE", vatNumber: "EE102013089", note: "UNION-OSS" },
  { country: "FR", vatNumber: "FR23888800463", note: "Cdiscount, схема REGULAR" },
  { country: "ES", vatNumber: "ESN0531416F", note: "Shopify, отгрузка внутри Испании" },
];

/**
 * Allegro reports no country — it reports a currency, and the country follows.
 * A euro sale is booked to Slovakia, which is an assumption the client
 * confirmed: if a second euro country ever appears it will be counted as SK,
 * silently. Kept as data so that assumption is visible and editable.
 */
export const ALLEGRO_CURRENCY_MAP = {
  PLN: { country: "PL", scheme: "REGULAR", sellerVat: "PL5263307678" },
  CZK: { country: "CZ", scheme: "UNION-OSS", sellerVat: "EE102013089" },
  EUR: { country: "SK", scheme: "UNION-OSS", sellerVat: "EE102013089" },
  HUF: { country: "HU", scheme: "UNION-OSS", sellerVat: "EE102013089" },
} as const;

export const CHANNEL_RULES: readonly {
  channel: string;
  key: string;
  value: unknown;
  note: string;
}[] = [
  {
    channel: "allegro",
    key: "currency_map",
    value: ALLEGRO_CURRENCY_MAP,
    note: "Валюта определяет страну получения, ставку и VAT-номер продавца.",
  },
  {
    channel: "allegro",
    key: "departure_country",
    value: "PL",
    note: "Отгрузка всегда из Польши.",
  },
  {
    channel: "allegro",
    key: "operation_types",
    value: { wpłata: "B2C SALE", zwrot: "REFUND" },
    note: "Прочие операции — комиссии Allegro, в отчёт не попадают.",
  },
  {
    channel: "cdiscount",
    key: "defaults",
    value: {
      currency: "EUR",
      departureCountry: "FR",
      arrivalCountry: "FR",
      scheme: "REGULAR",
      sellerVat: "FR23888800463",
    },
    note: "Cdiscount продаёт только во Франции.",
  },
  {
    channel: "cdiscount",
    key: "invoice_types",
    value: { Vente: "B2C SALE", "Remboursement client": "REFUND" },
    note: "Абонентская плата и комиссионные авуары в отчёт не попадают.",
  },
  {
    channel: "shopify",
    key: "defaults",
    value: {
      departureCountry: "ES",
      domesticScheme: "REGULAR",
      domesticSellerVat: "ESN0531416F",
      exportScheme: "UNION-OSS",
      exportSellerVat: "EE102013089",
    },
    note: "Отгрузка всегда из Испании; внутри Испании — REGULAR, иначе UNION-OSS.",
  },
  {
    channel: "shopify",
    key: "skipped_arrival_countries",
    value: ["CH"],
    note: "Заказы в Швейцарию в отчёт не идут — согласованное правило.",
  },
  {
    channel: "shopify",
    key: "country_aliases",
    value: { UK: "GB" },
    note: "Shopify пишет UK, отчётность требует GB.",
  },
  {
    channel: "shopify",
    key: "excluded_sources",
    value: ["shopify_draft_order"],
    note: "Черновики заказов — не продажи.",
  },
];

/** Amazon SKU → what the Zoho invoice should call it. */
export const SKU_MAPPINGS: readonly {
  channel: string;
  sourceSku: string;
  targetSku: string;
  itemName: string;
}[] = [
  {
    channel: "amazon",
    sourceSku: "QE-5795-1Z7V-stickerless",
    targetSku: "Geyser-Euro-filter",
    itemName: "Geyser Euro Filter",
  },
  {
    channel: "amazon",
    sourceSku: "9Z-0IH0-ECWV",
    targetSku: "Geyser-Euro-cartridge",
    itemName: "Geyser Euro Cartridge",
  },
  {
    channel: "amazon",
    sourceSku: "New-GeyserE-Cart1",
    targetSku: "Geyser-Euro-cartridge-china-set",
    itemName: "Geyser Euro Cartridge China",
  },
  {
    channel: "amazon",
    sourceSku: "GeyserEuro-1ExtraCart-stickerless",
    targetSku: "Geyser-Euro-filter-with-1-extra-cartridge",
    itemName: "Geyser Euro Filter with 1 extra Cartridge",
  },
  {
    channel: "amazon",
    sourceSku: "GeyserEuro-Cart2Pack-stickerless",
    targetSku: "Geyser-Euro-cartridge-2Pack",
    itemName: "Geyser Euro Cartridge 2-Pack",
  },
  {
    channel: "amazon",
    sourceSku: "77-BLDX-4JIN",
    targetSku: "Geyser-Smart-filter",
    itemName: "Geyser Smart Filter",
  },
  {
    channel: "amazon",
    sourceSku: "JU-Q9KH-S520",
    targetSku: "Geyser-Aqua-filter",
    itemName: "Geyser Aqua Filter",
  },
  {
    channel: "amazon",
    sourceSku: "QF-4FOT-LLRQ",
    targetSku: "Geyser-Euro-filter-with-1-extra-cartridge",
    itemName: "Geyser Euro Filter with 1 extra Cartridge",
  },
];

/** Connectors. Sold on Amazon, never invoiced through Zoho. */
export const IGNORED_SKUS: readonly string[] = [
  "60-YCQ8-2X91",
  "FS-4Y86-28IC",
  "LU-F721-W4E4",
  "N7-4OWI-CI81",
  "KU-9H0K-OEZW",
  "6M-RJI8-EJ35",
  "SB-C83K-BPM1",
];
