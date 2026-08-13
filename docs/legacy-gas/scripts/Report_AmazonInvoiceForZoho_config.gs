/**
 * Report_AmazonInvoiceForZoho_config.gs
 *
 * Только данные/соответствия.
 * Никакой бизнес-логики и функций.
 */

const AMAZON_INVOICE_COUNTRIES = Object.freeze([
  "ES",
  "IT",
  "FR",
  "DE",
  "UK",
  "SE",
  "PL",
  "NL",
  "IE",
  "BE"
]);


const AMAZON_INVOICE_OUTPUT_HEADERS = Object.freeze([
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
  "Account"
]);


/**
 * Как называется обычная продажа/заказ
 * в локализованном Amazon Monthly Transaction report.
 */
const AMAZON_INVOICE_ORDER_TYPES = Object.freeze({
  ES: "Pedido",
  IT: "Ordine",
  FR: "Commande",
  DE: "Bestellung",
  UK: "Order",
  SE: "Order",
  PL: "Zamówienie",
  NL: "Bestelling",
  IE: "Order",
  BE: "Commande"
});


/**
 * Соответствие логических полей локализованным колонкам Amazon.
 */
const AMAZON_INVOICE_SOURCE_COLUMNS = Object.freeze({
  ES: Object.freeze({
    sku: Object.freeze(["sku"]),
    amount: Object.freeze([
      "cantidad",
      "amount"
    ]),
    productSales: Object.freeze([
      "ventas de productos",
      "product sales"
    ])
  }),

  IT: Object.freeze({
    sku: Object.freeze(["SKU"]),
    amount: Object.freeze([
      "Quantità"
    ]),
    productSales: Object.freeze([
      "Vendite"
    ])
  }),

  FR: Object.freeze({
    sku: Object.freeze([
      "sku",
      "SKU"
    ]),
    amount: Object.freeze([
      "quantité"
    ]),
    productSales: Object.freeze([
      "ventes de produits"
    ])
  }),

  DE: Object.freeze({
    sku: Object.freeze([
      "SKU"
    ]),
    amount: Object.freeze([
      "Menge"
    ]),
    productSales: Object.freeze([
      "Umsätze"
    ])
  }),

  UK: Object.freeze({
    sku: Object.freeze([
      "sku"
    ]),
    amount: Object.freeze([
      "quantity"
    ]),
    productSales: Object.freeze([
      "product sales"
    ])
  }),

  SE: Object.freeze({
    sku: Object.freeze([
      "sku"
    ]),
    amount: Object.freeze([
      "antal"
    ]),
    productSales: Object.freeze([
      "försäljning av produkter"
    ])
  }),

  PL: Object.freeze({
    sku: Object.freeze([
      "sku"
    ]),
    amount: Object.freeze([
      "ilość"
    ]),
    productSales: Object.freeze([
      "sprzedaż produktów"
    ])
  }),

  NL: Object.freeze({
    sku: Object.freeze([
      "sku"
    ]),
    amount: Object.freeze([
      "aantal"
    ]),
    productSales: Object.freeze([
      "verkoop van producten"
    ])
  }),

  IE: Object.freeze({
    sku: Object.freeze([
      "sku"
    ]),
    amount: Object.freeze([
      "quantity"
    ]),
    productSales: Object.freeze([
      "product sales"
    ])
  }),

  BE: Object.freeze({
    sku: Object.freeze([
      "SKU",
      "sku"
    ]),
    amount: Object.freeze([
      "quantité"
    ]),
    productSales: Object.freeze([
      "ventes de produits"
    ])
  })
});


/**
 * Amazon SKU -> данные для итогового Zoho invoice.
 */
const AMAZON_INVOICE_SKU_MAPPINGS = Object.freeze({
  "QE-5795-1Z7V-stickerless": Object.freeze({
    invoiceSku: "Geyser-Euro-filter",
    itemName: "Geyser Euro Filter"
  }),

  "9Z-0IH0-ECWV": Object.freeze({
    invoiceSku: "Geyser-Euro-cartridge",
    itemName: "Geyser Euro Cartridge"
  }),

  "New-GeyserE-Cart1": Object.freeze({
    invoiceSku: "Geyser-Euro-cartridge-china-set",
    itemName: "Geyser Euro Cartridge China"
  }),
  
  "GeyserEuro-1ExtraCart-stickerless": Object.freeze({
    invoiceSku: "Geyser-Euro-filter-with-1-extra-cartridge",
    itemName: "Geyser Euro Filter with 1 extra Cartridge"
  }),

  "GeyserEuro-Cart2Pack-stickerless": Object.freeze({
    invoiceSku: "Geyser-Euro-cartridge-2Pack",
    itemName: "Geyser Euro Cartridge 2-Pack"
  }),

  "77-BLDX-4JIN": Object.freeze({
    invoiceSku: "Geyser-Smart-filter",
    itemName: "Geyser Smart Filter"
  }),

  "JU-Q9KH-S520": Object.freeze({
    invoiceSku: "Geyser-Aqua-filter",
    itemName: "Geyser Aqua Filter"
  }),

  "QF-4FOT-LLRQ": Object.freeze({
    invoiceSku: "Geyser-Euro-filter-with-1-extra-cartridge",
    itemName: "Geyser Euro Filter with 1 extra Cartridge"
  })

});


/**
 * Эти SKU не должны попадать в итоговый invoice.
 */
const AMAZON_INVOICE_IGNORED_SKUS = Object.freeze([
  "60-YCQ8-2X91",
  "FS-4Y86-28IC",
  "LU-F721-W4E4",
  "N7-4OWI-CI81",
  "KU-9H0K-OEZW",
  "6M-RJI8-EJ35",
  "SB-C83K-BPM1"
]);