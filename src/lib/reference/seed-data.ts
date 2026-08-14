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

/**
 * Channel rules live with their modules; re-exported here so seeding and the
 * golden harness keep one import for "what a fresh tenant starts with".
 */
export { CHANNEL_RULES } from "@/modules/channels/registry";
export { ALLEGRO_CURRENCY_MAP } from "@/modules/channels/allegro";

export const VAT_RATES: readonly { country: string; rate: string; note?: string }[] = [
  { country: "PL", rate: "23", note: "Allegro, sales settled in złoty" },
  { country: "CZ", rate: "21", note: "Allegro, sales settled in koruna" },
  { country: "SK", rate: "20", note: "Allegro, sales settled in euro — an agreed assumption" },
  { country: "HU", rate: "27", note: "Allegro, sales settled in forint" },
  { country: "FR", rate: "20", note: "Cdiscount" },
  { country: "ES", rate: "21" },
  { country: "DE", rate: "19" },
  { country: "IT", rate: "22" },
  { country: "NL", rate: "21" },
  { country: "BE", rate: "21" },
  { country: "IE", rate: "23" },
  { country: "SE", rate: "25" },
  { country: "GB", rate: "20", note: "Shopify: used when the file carries no rate" },
];

export const SELLER_VAT_NUMBERS: readonly {
  country: string;
  vatNumber: string;
  note?: string;
}[] = [
  { country: "PL", vatNumber: "PL5263307678", note: "Allegro, REGULAR scheme" },
  { country: "EE", vatNumber: "EE102013089", note: "UNION-OSS" },
  { country: "FR", vatNumber: "FR23888800463", note: "Cdiscount, REGULAR scheme" },
  { country: "ES", vatNumber: "ESN0531416F", note: "Shopify, shipped within Spain" },
];

/**
 * Allegro reports no country — it reports a currency, and the country follows.
 * A euro sale is booked to Slovakia, which is an assumption the client
 * confirmed: if a second euro country ever appears it will be counted as SK,
 * silently. Kept as data so that assumption is visible and editable.
 */
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
