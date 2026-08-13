/**
 * Classifier.gs
 *
 * Этот файл содержит только классификацию.
 * Он не обращается к Drive или SpreadsheetApp.
 */

const REPORT_TYPES = Object.freeze({
  AMAZON_VAT_TRANSACTION_REPORT: Object.freeze({
    type:
      "Amazon VAT transaction report",

    folderId:
      "1PHothmoaIfKXB4HKb2ipi1T4KVscknfL",

    headerRowIndex: 0,

    requiredHeaders: Object.freeze([
      "UNIQUE_ACCOUNT_IDENTIFIER",
      "ACTIVITY_PERIOD",
      "SALES_CHANNEL",
      "MARKETPLACE",
      "PROGRAM_TYPE",
      "TRANSACTION_TYPE"
    ]),

    periodResolver:
      "amazonVatTransaction",

    periodColumn:
      "ACTIVITY_PERIOD",

    periodFilterColumn:
      "SALES_CHANNEL",

    periodFilterValue:
      "AFN"
  }),

  ALLEGRO_SALES_REPORT: Object.freeze({
    type:
      "Allegro sales report",

    folderId:
      "1mY8y5zs5qZDrUJGqcjNgr_YOervdLreA",

    headerRowIndex: 0,

    requiredHeaders: Object.freeze([
      "data",
      "data zaksięgowania",
      "identyfikator",
      "operacja",
      "operator"
    ]),

    periodResolver:
      "allegroSales",

    periodColumn:
      "data"
  }),

  CDISCOUNT_SALES_REPORT: Object.freeze({
    type:
      "Cdiscount sales report",

    folderId:
      "1OzTskRUy8jO1429gWMGDO3pCQ2eCKtgi",

    headerRowIndex: 2,

    requiredHeaders: Object.freeze([
      "Sales channel",
      "Shop Id",
      "Invoice/Refund Id",
      "Accounting date"
    ]),

    periodResolver:
      "cdiscountSales",

    periodColumn:
      "Accounting date"
  }),

  GEYSER_SHOPIFY_SALES_REPORT: Object.freeze({
    type:
      "Geyser shopify sales report",

    folderId:
      "12H_qu23GTMQgN_9osLoH9ILb7LSKy_Q-",

    headerRowIndex: 0,

    requiredHeaders: Object.freeze([
      "Name",
      "Email",
      "Financial Status",
      "Paid at",
      "Fulfillment Status",
      "Created at"
    ]),

    periodResolver:
      "geyserShopifySales",

    periodColumn:
      "Created at"
  })
});


const AMAZON_MONTHLY_TRANSACTION_CONFIG =
  Object.freeze({
    headerSearchMaxRows: 20,

    countries: Object.freeze({
      ES: Object.freeze({
        type:
          "Amazon Monthly Transaction report ES",
        folderId:
          "19Hs6Lr32uNu1earnBmkwjt0RCNJXp4ow"
      }),

      IT: Object.freeze({
        type:
          "Amazon Monthly Transaction report IT",
        folderId:
          "1XG3eX1R1F3FlvUu6ocgh-ErC6m9RIq6i"
      }),

      FR: Object.freeze({
        type:
          "Amazon Monthly Transaction report FR",
        folderId:
          "1KOdn-hNWoj_zgPwiSl4skCICEJzqHWQ7"
      }),

      DE: Object.freeze({
        type:
          "Amazon Monthly Transaction report DE",
        folderId:
          "1o5JbrKU1oPHE4Xg9C-JgxKvpjgSEtD9S"
      }),

      UK: Object.freeze({
        type:
          "Amazon Monthly Transaction report UK",
        folderId:
          "1vPXN0znaOOC5WpdAXx4Ev14M7pg4FpjD"
      }),

      SE: Object.freeze({
        type:
          "Amazon Monthly Transaction report SE",
        folderId:
          "1N9pQk2CU_GxT-J3PyfUmuHTW-Gg3X04m"
      }),

      PL: Object.freeze({
        type:
          "Amazon Monthly Transaction report PL",
        folderId:
          "1928co5tZ90FSkcZTtbD_7Ibw5zJm0qV4"
      }),

      NL: Object.freeze({
        type:
          "Amazon Monthly Transaction report NL",
        folderId:
          "1pw5JpKMEBaeIpMr8njMiv1xtKK6HESLt"
      }),

      IE: Object.freeze({
        type:
          "Amazon Monthly Transaction report IE",
        folderId:
          "1zyr89zk0k5XNPvLkIYQA9u9TOZvsEBSV"
      }),

      BE: Object.freeze({
        type:
          "Amazon Monthly Transaction report BE",
        folderId:
          "14VlU1cAXo3WY7r2W5ffpIdFuWQPIpvhB"
      })
    }),

    marketplaceDomains: Object.freeze({
      "amazon.es": "ES",
      "amazon.it": "IT",
      "amazon.fr": "FR",
      "amazon.de": "DE",
      "amazon.co.uk": "UK",
      "amazon.se": "SE",
      "amazon.pl": "PL",
      "amazon.nl": "NL",
      "amazon.ie": "IE",
      "amazon.com.be": "BE"
    }),

    headerProfiles: Object.freeze([
      Object.freeze({
        key: "ES",
        requiredHeaders: Object.freeze([
          "fecha y hora",
          "identificador de pago",
          "tipo",
          "número de pedido",
          "sku"
        ]),
        marketplaceHeader: "web de Amazon",
        fallbackCountryCode: "ES"
      }),

      Object.freeze({
        key: "IT",
        requiredHeaders: Object.freeze([
          "Data/Ora",
          "Numero pagamento",
          "Tipo",
          "Numero ordine",
          "SKU"
        ]),
        marketplaceHeader: "Marketplace",
        fallbackCountryCode: "IT"
      }),

      Object.freeze({
        key: "FR",
        requiredHeaders: Object.freeze([
          "date/heure",
          "numéro de versement",
          "type",
          "numéro de la commande",
          "sku"
        ]),
        marketplaceHeader: "Marketplace",
        fallbackCountryCode: "FR"
      }),

      Object.freeze({
        key: "FR_ALT",
        requiredHeaders: Object.freeze([
          "date/heure",
          "Identifiant du paiement",
          "type",
          "Numéro de la commande",
          "SKU"
        ]),
        marketplaceHeader: "site de vente",
        fallbackCountryCode: null
      }),

      Object.freeze({
        key: "DE",
        requiredHeaders: Object.freeze([
          "Datum/Uhrzeit",
          "Abrechnungsnummer",
          "Typ",
          "Bestellnummer",
          "SKU"
        ]),
        marketplaceHeader: "Marketplace",
        fallbackCountryCode: "DE"
      }),

      Object.freeze({
        key: "SE",
        requiredHeaders: Object.freeze([
          "datum/tid",
          "reglerings-id",
          "typ",
          "beställnings-id",
          "sku"
        ]),
        marketplaceHeader: "marknadsplats",
        fallbackCountryCode: "SE"
      }),

      Object.freeze({
        key: "PL",
        requiredHeaders: Object.freeze([
          "data/godzina",
          "identyfikator rozliczenia",
          "typ",
          "identyfikator zamówienia",
          "sku"
        ]),
        marketplaceHeader: "rynek",
        fallbackCountryCode: "PL"
      }),

      Object.freeze({
        key: "NL",
        requiredHeaders: Object.freeze([
          "datum/tijd",
          "schikkings-ID",
          "type",
          "bestelnummer",
          "sku"
        ]),
        marketplaceHeader: "marketplace",
        fallbackCountryCode: "NL"
      }),

      Object.freeze({
        key: "EN",
        requiredHeaders: Object.freeze([
          "date/time",
          "settlement ID",
          "type",
          "order ID",
          "sku"
        ]),
        marketplaceHeader: "marketplace",
        fallbackCountryCode: null
      })
    ])
  });


const REPORT_MONTHS = Object.freeze({
  JAN: Object.freeze({
    number: 1,
    numberText: "01",
    fullName: "January",
    quarter: 1
  }),

  FEB: Object.freeze({
    number: 2,
    numberText: "02",
    fullName: "February",
    quarter: 1
  }),

  MAR: Object.freeze({
    number: 3,
    numberText: "03",
    fullName: "March",
    quarter: 1
  }),

  APR: Object.freeze({
    number: 4,
    numberText: "04",
    fullName: "April",
    quarter: 2
  }),

  MAY: Object.freeze({
    number: 5,
    numberText: "05",
    fullName: "May",
    quarter: 2
  }),

  JUN: Object.freeze({
    number: 6,
    numberText: "06",
    fullName: "June",
    quarter: 2
  }),

  JUL: Object.freeze({
    number: 7,
    numberText: "07",
    fullName: "July",
    quarter: 3
  }),

  AUG: Object.freeze({
    number: 8,
    numberText: "08",
    fullName: "August",
    quarter: 3
  }),

  SEP: Object.freeze({
    number: 9,
    numberText: "09",
    fullName: "September",
    quarter: 3
  }),

  OCT: Object.freeze({
    number: 10,
    numberText: "10",
    fullName: "October",
    quarter: 4
  }),

  NOV: Object.freeze({
    number: 11,
    numberText: "11",
    fullName: "November",
    quarter: 4
  }),

  DEC: Object.freeze({
    number: 12,
    numberText: "12",
    fullName: "December",
    quarter: 4
  })
});


/**
 * @param {string[][]} values
 * @return {Object}
 */
function classifyReport(values, originalFileName) {
  if (
    !Array.isArray(values) ||
    values.length === 0
  ) {
    return createUndefinedClassification_(
      "type_not_detected",
      false,
      "EMPTY_DATA",
      "Файл сохранён, но тип отчёта не удалось определить. " +
        "Файл помещён в папку Undefined."
    );
  }

  const amazonMonthlyDetection =
    detectAmazonMonthlyTransactionReport_(
      values
    );

  if (amazonMonthlyDetection.detected) {
    if (!amazonMonthlyDetection.success) {
      const undefinedResult =
        createUndefinedClassification_(
          "country_not_detected",
          true,
          amazonMonthlyDetection.reason,
          "Тип Amazon Monthly Transaction report распознан, " +
            "но страну отчёта не удалось определить. " +
            "Файл помещён в папку Undefined."
        );

      undefinedResult.isAmazonMonthlyTransaction =
        true;

      undefinedResult.outputStartRowIndex =
        amazonMonthlyDetection.headerRowIndex;

      return undefinedResult;
    }

    const periodResult =
      determineAmazonMonthlyTransactionFilenamePeriod_(
        originalFileName
      );

    if (!periodResult.success) {
      const undefinedResult =
        createUndefinedClassification_(
          "period_invalid",
          true,
          periodResult.reason,
          "Тип отчёта распознан, но период не удалось определить " +
            "из имени файла. Имя должно начинаться со значения " +
            "в формате YYYYMon, например 2024Dec."
        );

      undefinedResult.isAmazonMonthlyTransaction =
        true;

      undefinedResult.outputStartRowIndex =
        amazonMonthlyDetection.headerRowIndex;

      return undefinedResult;
    }

    return {
      classified: true,
      typeDetected: true,
      type: amazonMonthlyDetection.type,
      period: periodResult.period,
      folderId: amazonMonthlyDetection.folderId,
      status: "classified",
      warning: null,
      technicalReason: null,

      isAmazonMonthlyTransaction: true,
      preserveAllVersions: true,

      countryCode:
        amazonMonthlyDetection.countryCode,

      marketplace:
        amazonMonthlyDetection.marketplaceValue,

      detectedHeaderRowIndex:
        amazonMonthlyDetection.headerRowIndex,

      outputStartRowIndex:
        amazonMonthlyDetection.headerRowIndex
    };
  }

  const rules = Object.values(REPORT_TYPES);

  for (
    let ruleIndex = 0;
    ruleIndex < rules.length;
    ruleIndex += 1
  ) {
    const rule = rules[ruleIndex];

    const detectedHeaderRowIndex =
      findMatchingHeaderRowIndex_(
        values,
        rule
      );

    if (detectedHeaderRowIndex === -1) {
      continue;
    }

    const periodResult =
      determineReportPeriod_(
        values,
        rule,
        originalFileName
      );

    if (!periodResult.success) {
      return createUndefinedClassification_(
        "period_invalid",
        true,
        periodResult.reason,
        "Тип отчёта распознан, но период некорректен: " +
          "файл должен содержать один месяц или полный календарный квартал."
      );
    }

    return {
      classified: true,
      typeDetected: true,
      type: rule.type,
      period: periodResult.period,
      folderId: rule.folderId,
      status: "classified",
      warning: null,
      technicalReason: null,

      detectedHeaderRowIndex:
        detectedHeaderRowIndex,

      outputStartRowIndex:
        detectedHeaderRowIndex
    };
  }

  return createUndefinedClassification_(
    "type_not_detected",
    false,
    "REQUIRED_HEADERS_NOT_FOUND",
    "Файл сохранён, но тип отчёта не удалось определить. " +
      "Файл помещён в папку Undefined."
  );
}


/**
 * Проверяет наличие всех обязательных заголовков.
 *
 * Регистр игнорируется.
 * Позиция и порядок колонок не важны.
 * Пробелы не удаляются.
 *
 * @param {string[][]} values
 * @param {Object} rule
 * @return {boolean}
 */
function matchesRequiredHeaders_(values, rule) {
  return (
    findMatchingHeaderRowIndex_(
      values,
      rule
    ) !== -1
  );
}


/**
 * Находит строку, содержащую все обязательные заголовки.
 *
 * По умолчанию проверяется фиксированная строка rule.headerRowIndex.
 * Если у правила задан headerSearchMaxRows, проверяются строки
 * от первой до указанного лимита.
 *
 * @param {string[][]} values
 * @param {Object} rule
 * @return {number} индекс строки или -1
 */
function findMatchingHeaderRowIndex_(
  values,
  rule
) {
  if (
    !rule ||
    !Array.isArray(rule.requiredHeaders) ||
    rule.requiredHeaders.length === 0
  ) {
    return -1;
  }

  let candidateIndexes = [];

  if (
    Number.isInteger(rule.headerSearchMaxRows) &&
    rule.headerSearchMaxRows > 0
  ) {
    const rowsToCheck =
      Math.min(
        values.length,
        rule.headerSearchMaxRows
      );

    for (
      let rowIndex = 0;
      rowIndex < rowsToCheck;
      rowIndex += 1
    ) {
      candidateIndexes.push(rowIndex);
    }
  } else if (
    Number.isInteger(rule.headerRowIndex)
  ) {
    candidateIndexes = [
      rule.headerRowIndex
    ];
  } else {
    return -1;
  }

  const normalizedRequiredHeaders =
    rule.requiredHeaders.map(
      function (requiredHeader) {
        return normalizeHeader_(
          requiredHeader,
          false
        );
      }
    );

  for (
    let candidateIndex = 0;
    candidateIndex < candidateIndexes.length;
    candidateIndex += 1
  ) {
    const rowIndex =
      candidateIndexes[candidateIndex];

    const headerRow =
      values[rowIndex];

    if (
      !Array.isArray(headerRow) ||
      headerRow.length === 0
    ) {
      continue;
    }

    const normalizedHeaders =
      headerRow.map(
        function (value, index) {
          return normalizeHeader_(
            value,
            index === 0
          );
        }
      );

    const headerSet =
      new Set(normalizedHeaders);

    const matches =
      normalizedRequiredHeaders.every(
        function (requiredHeader) {
          return headerSet.has(
            requiredHeader
          );
        }
      );

    if (matches) {
      return rowIndex;
    }
  }

  return -1;
}


/**
 * Определяет период в зависимости от типа отчёта.
 *
 * @param {string[][]} values
 * @param {Object} rule
 * @return {Object}
 */
function determineReportPeriod_(values, rule, originalFileName) {
  switch (rule.periodResolver) {
    case "amazonVatTransaction":
      return determineAmazonReportPeriod_(
        values,
        rule
      );

    case "allegroSales":
      return determineAllegroReportPeriod_(
        values,
        rule
      );

    case "cdiscountSales":
      return determineCdiscountReportPeriod_(
        values,
        rule
      );

    case "geyserShopifySales":
      return determineGeyserShopifyReportPeriod_(
        values,
        rule
      );

    default:
      return createPeriodError_(
        "UNKNOWN_PERIOD_RESOLVER"
      );
  }
}


/**
 * Распознаёт семейство Amazon Monthly Transaction report.
 */
function detectAmazonMonthlyTransactionReport_(
  values
) {
  const config =
    AMAZON_MONTHLY_TRANSACTION_CONFIG;

  if (
    !Array.isArray(values) ||
    values.length === 0
  ) {
    return {
      detected: false,
      success: false,
      reason: "EMPTY_DATA",
      headerRowIndex: -1
    };
  }

  const rowsToCheck =
    Math.min(
      values.length,
      config.headerSearchMaxRows
    );

  for (
    let profileIndex = 0;
    profileIndex <
      config.headerProfiles.length;
    profileIndex += 1
  ) {
    const profile =
      config.headerProfiles[profileIndex];

    for (
      let rowIndex = 0;
      rowIndex < rowsToCheck;
      rowIndex += 1
    ) {
      const headerRow =
        Array.isArray(values[rowIndex])
          ? values[rowIndex]
          : [];

      if (
        !amazonMonthlyHeadersMatch_(
          headerRow,
          profile.requiredHeaders
        )
      ) {
        continue;
      }

      const marketplaceColumnIndex =
        findAmazonMonthlyHeaderIndex_(
          headerRow,
          profile.marketplaceHeader
        );

      if (marketplaceColumnIndex === -1) {
        return {
          detected: true,
          success: false,
          reason:
            "MARKETPLACE_COLUMN_NOT_FOUND",
          headerRowIndex: rowIndex,
          profileKey: profile.key
        };
      }

      const marketplaceValue =
        findFirstAmazonMarketplaceValue_(
          values,
          rowIndex + 1,
          marketplaceColumnIndex
        );

      if (marketplaceValue) {
        const normalizedMarketplace =
          String(marketplaceValue)
            .trim()
            .toLowerCase();

        const countryCode =
          config.marketplaceDomains[
            normalizedMarketplace
          ];

        if (!countryCode) {
          return {
            detected: true,
            success: false,
            reason:
              "UNSUPPORTED_MARKETPLACE_DOMAIN",
            headerRowIndex: rowIndex,
            profileKey: profile.key,
            marketplaceValue:
              marketplaceValue
          };
        }

        const countryConfig =
          config.countries[countryCode];

        if (!countryConfig) {
          return {
            detected: true,
            success: false,
            reason:
              "COUNTRY_CONFIG_NOT_FOUND",
            headerRowIndex: rowIndex,
            profileKey: profile.key,
            marketplaceValue:
              marketplaceValue,
            countryCode:
              countryCode
          };
        }

        return {
          detected: true,
          success: true,
          reason: null,
          headerRowIndex: rowIndex,
          marketplaceColumnIndex:
            marketplaceColumnIndex,
          marketplaceValue:
            marketplaceValue,
          profileKey: profile.key,
          countryCode:
            countryCode,
          type:
            countryConfig.type,
          folderId:
            countryConfig.folderId
        };
      }

      if (profile.fallbackCountryCode) {
        const countryConfig =
          config.countries[
            profile.fallbackCountryCode
          ];

        return {
          detected: true,
          success: true,
          reason: null,
          headerRowIndex: rowIndex,
          marketplaceColumnIndex:
            marketplaceColumnIndex,
          marketplaceValue: null,
          profileKey: profile.key,
          countryCode:
            profile.fallbackCountryCode,
          type:
            countryConfig.type,
          folderId:
            countryConfig.folderId
        };
      }

      return {
        detected: true,
        success: false,
        reason:
          "MARKETPLACE_VALUE_NOT_FOUND",
        headerRowIndex: rowIndex,
        marketplaceColumnIndex:
          marketplaceColumnIndex,
        marketplaceValue: null,
        profileKey: profile.key
      };
    }
  }

  return {
    detected: false,
    success: false,
    reason:
      "AMAZON_MONTHLY_HEADERS_NOT_FOUND",
    headerRowIndex: -1
  };
}


function amazonMonthlyHeadersMatch_(
  headerRow,
  requiredHeaders
) {
  if (
    !Array.isArray(headerRow) ||
    !Array.isArray(requiredHeaders)
  ) {
    return false;
  }

  const headerSet =
    new Set(
      headerRow.map(
        function (value, index) {
          return normalizeAmazonMonthlyHeader_(
            value,
            index === 0
          );
        }
      )
    );

  return requiredHeaders.every(
    function (requiredHeader) {
      return headerSet.has(
        normalizeAmazonMonthlyHeader_(
          requiredHeader,
          false
        )
      );
    }
  );
}


function findAmazonMonthlyHeaderIndex_(
  headerRow,
  requiredHeader
) {
  const expected =
    normalizeAmazonMonthlyHeader_(
      requiredHeader,
      false
    );

  for (
    let index = 0;
    index < headerRow.length;
    index += 1
  ) {
    const actual =
      normalizeAmazonMonthlyHeader_(
        headerRow[index],
        index === 0
      );

    if (actual === expected) {
      return index;
    }
  }

  return -1;
}


function findFirstAmazonMarketplaceValue_(
  values,
  startRowIndex,
  marketplaceColumnIndex
) {
  for (
    let rowIndex = startRowIndex;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const row =
      Array.isArray(values[rowIndex])
        ? values[rowIndex]
        : [];

    const value =
      String(
        row[marketplaceColumnIndex] === null ||
        typeof row[marketplaceColumnIndex] ===
          "undefined"
          ? ""
          : row[marketplaceColumnIndex]
      ).trim();

    if (
      value &&
      value.toLowerCase().startsWith(
        "amazon"
      )
    ) {
      return value;
    }
  }

  return null;
}


function normalizeAmazonMonthlyHeader_(
  value,
  removeBom
) {
  let normalized =
    String(
      value === null ||
      typeof value === "undefined"
        ? ""
        : value
    );

  if (removeBom) {
    normalized =
      normalized.replace(/^\uFEFF/, "");
  }

  return normalized
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/:\s*$/, "")
    .trim()
    .toUpperCase();
}


function determineAmazonMonthlyTransactionFilenamePeriod_(
  originalFileName
) {
  const fileName =
    String(originalFileName || "");

  const match =
    fileName.match(
      /^(\d{4})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/
    );

  if (!match) {
    return createPeriodError_(
      "INVALID_FILENAME_PERIOD"
    );
  }

  const year =
    Number(match[1]);

  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 9999
  ) {
    return createPeriodError_(
      "INVALID_FILENAME_YEAR"
    );
  }

  const month =
    REPORT_MONTHS[
      String(match[2]).toUpperCase()
    ];

  if (!month) {
    return createPeriodError_(
      "INVALID_FILENAME_MONTH"
    );
  }

  return {
    success: true,
    period:
      year +
      "." +
      month.numberText +
      " " +
      month.fullName,
    reason: null
  };
}


/**
 * Определяет период Geyser shopify sales report.
 *
 * Заголовки находятся в первой строке.
 * Анализируются значения Created at во всех строках.
 *
 * Формат:
 * yyyy-MM-dd HH:mm:ss +HHMM
 *
 * Пример:
 * 2026-07-31 22:34:13 +0300
 *
 * @param {string[][]} values
 * @param {Object} rule
 * @return {Object}
 */
function determineGeyserShopifyReportPeriod_(
  values,
  rule
) {
  const headerRow =
    values[rule.headerRowIndex];

  if (!Array.isArray(headerRow)) {
    return createPeriodError_(
      "HEADER_ROW_NOT_FOUND"
    );
  }

  const dateColumnIndex =
    findHeaderIndex_(
      headerRow,
      rule.periodColumn
    );

  if (dateColumnIndex === -1) {
    return createPeriodError_(
      "PERIOD_COLUMN_NOT_FOUND"
    );
  }

  const uniquePeriods =
    new Map();

  let dataRowsFound = false;

  for (
    let rowIndex =
      rule.headerRowIndex + 1;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const row =
      Array.isArray(values[rowIndex])
        ? values[rowIndex]
        : [];

    const rawDate =
      row[dateColumnIndex];

    /**
     * Пустые значения Created at игнорируются.
     */
    if (
      rawDate === "" ||
      rawDate === null ||
      typeof rawDate === "undefined"
    ) {
      continue;
    }

    dataRowsFound = true;

    const parsedPeriod =
      parseGeyserShopifyDate_(
        String(rawDate).trim()
      );

    if (!parsedPeriod) {
      return createPeriodError_(
        "INVALID_SHOPIFY_DATE"
      );
    }

    addUniquePeriod_(
      uniquePeriods,
      parsedPeriod
    );
  }

  if (!dataRowsFound) {
    return createPeriodError_(
      "NO_PERIOD_VALUES"
    );
  }

  return buildReportPeriod_(
    Array.from(
      uniquePeriods.values()
    )
  );
}

/**
 * Разбирает дату Shopify.
 *
 * Строгий формат:
 * yyyy-MM-dd HH:mm:ss +HHMM
 *
 * Также поддерживается отрицательное смещение:
 * yyyy-MM-dd HH:mm:ss -HHMM
 *
 * @param {string} value
 * @return {Object|null}
 */
function parseGeyserShopifyDate_(value) {
  const match =
    String(value).match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-])(\d{2})(\d{2})$/
    );

  if (!match) {
    return null;
  }

  const year =
    Number(match[1]);

  const monthNumber =
    Number(match[2]);

  const day =
    Number(match[3]);

  const hour =
    Number(match[4]);

  const minute =
    Number(match[5]);

  const second =
    Number(match[6]);

  const offsetSign =
    match[7];

  const offsetHour =
    Number(match[8]);

  const offsetMinute =
    Number(match[9]);

  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 9999 ||

    !Number.isInteger(monthNumber) ||
    monthNumber < 1 ||
    monthNumber > 12 ||

    !Number.isInteger(day) ||
    day < 1 ||
    day > 31 ||

    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||

    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||

    !Number.isInteger(second) ||
    second < 0 ||
    second > 59 ||

    !Number.isInteger(offsetHour) ||
    offsetHour < 0 ||
    offsetHour > 14 ||

    !Number.isInteger(offsetMinute) ||
    offsetMinute < 0 ||
    offsetMinute > 59
  ) {
    return null;
  }

  /**
   * Максимальное реальное смещение —
   * ±14:00.
   */
  if (
    offsetHour === 14 &&
    offsetMinute !== 0
  ) {
    return null;
  }

  if (
    offsetSign !== "+" &&
    offsetSign !== "-"
  ) {
    return null;
  }

  /**
   * Проверяем существование локальной
   * календарной даты.
   *
   * Часовой пояс не нужен для определения
   * месяца, но его формат проверяется выше.
   */
  const date =
    new Date(
      Date.UTC(
        year,
        monthNumber - 1,
        day,
        hour,
        minute,
        second
      )
    );

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !==
      monthNumber - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }

  const month =
    getReportMonthByNumber_(
      monthNumber
    );

  if (!month) {
    return null;
  }

  return {
    year: year,
    month: month
  };
}

/**
 * Определяет период Cdiscount sales report.
 *
 * Заголовки находятся в строке 3.
 * Даты анализируются во всех строках после заголовка.
 *
 * Формат даты:
 * yyyy-MM-dd
 *
 * Пример:
 * 2026-06-01
 *
 * @param {string[][]} values
 * @param {Object} rule
 * @return {Object}
 */
function determineCdiscountReportPeriod_(
  values,
  rule
) {
  const headerRow =
    values[rule.headerRowIndex];

  if (!Array.isArray(headerRow)) {
    return createPeriodError_(
      "HEADER_ROW_NOT_FOUND"
    );
  }

  const dateColumnIndex =
    findHeaderIndex_(
      headerRow,
      rule.periodColumn
    );

  if (dateColumnIndex === -1) {
    return createPeriodError_(
      "PERIOD_COLUMN_NOT_FOUND"
    );
  }

  const uniquePeriods =
    new Map();

  let dataRowsFound = false;

  for (
    let rowIndex =
      rule.headerRowIndex + 1;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const row =
      Array.isArray(values[rowIndex])
        ? values[rowIndex]
        : [];

    const rawDate =
      row[dateColumnIndex];

    /**
     * Пустые даты игнорируются.
     */
    if (
      rawDate === "" ||
      rawDate === null ||
      typeof rawDate === "undefined"
    ) {
      continue;
    }

    dataRowsFound = true;

    const parsedPeriod =
      parseCdiscountDate_(
        String(rawDate).trim()
      );

    if (!parsedPeriod) {
      return createPeriodError_(
        "INVALID_CDISCOUNT_DATE"
      );
    }

    addUniquePeriod_(
      uniquePeriods,
      parsedPeriod
    );
  }

  if (!dataRowsFound) {
    return createPeriodError_(
      "NO_PERIOD_VALUES"
    );
  }

  return buildReportPeriod_(
    Array.from(
      uniquePeriods.values()
    )
  );
}

/**
 * Разбирает дату Cdiscount.
 *
 * Строгий формат:
 * yyyy-MM-dd
 *
 * Пример:
 * 2026-06-01
 *
 * @param {string} value
 * @return {Object|null}
 */
function parseCdiscountDate_(value) {
  const match =
    String(value).match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (!match) {
    return null;
  }

  const year =
    Number(match[1]);

  const monthNumber =
    Number(match[2]);

  const day =
    Number(match[3]);

  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 9999 ||
    !Number.isInteger(monthNumber) ||
    monthNumber < 1 ||
    monthNumber > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  /**
   * Проверяем, что такая календарная дата существует.
   */
  const date =
    new Date(
      Date.UTC(
        year,
        monthNumber - 1,
        day
      )
    );

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !==
      monthNumber - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  const month =
    getReportMonthByNumber_(
      monthNumber
    );

  if (!month) {
    return null;
  }

  return {
    year: year,
    month: month
  };
}

/**
 * Определяет период Amazon VAT transaction report.
 *
 * Анализируются только строки:
 * SALES_CHANNEL = AFN.
 *
 * @param {string[][]} values
 * @param {Object} rule
 * @return {Object}
 */
function determineAmazonReportPeriod_(
  values,
  rule
) {
  const headerRow =
    values[rule.headerRowIndex];

  if (!Array.isArray(headerRow)) {
    return createPeriodError_(
      "HEADER_ROW_NOT_FOUND"
    );
  }

  const periodColumnIndex =
    findHeaderIndex_(
      headerRow,
      rule.periodColumn
    );

  if (periodColumnIndex === -1) {
    return createPeriodError_(
      "PERIOD_COLUMN_NOT_FOUND"
    );
  }

  const filterColumnIndex =
    findHeaderIndex_(
      headerRow,
      rule.periodFilterColumn
    );

  if (filterColumnIndex === -1) {
    return createPeriodError_(
      "FILTER_COLUMN_NOT_FOUND"
    );
  }

  const expectedFilterValue =
    String(
      rule.periodFilterValue
    ).toUpperCase();

  const uniquePeriods =
    new Map();

  let matchingRowsFound = false;

  for (
    let rowIndex =
      rule.headerRowIndex + 1;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const row =
      Array.isArray(values[rowIndex])
        ? values[rowIndex]
        : [];

    const filterValue =
      String(
        row[filterColumnIndex] === null ||
        typeof row[filterColumnIndex] ===
          "undefined"
          ? ""
          : row[filterColumnIndex]
      )
        .trim()
        .toUpperCase();

    if (
      filterValue !==
      expectedFilterValue
    ) {
      continue;
    }

    matchingRowsFound = true;

    const rawPeriod =
      row[periodColumnIndex];

    if (
      rawPeriod === "" ||
      rawPeriod === null ||
      typeof rawPeriod === "undefined"
    ) {
      continue;
    }

    const parsedPeriod =
      parseAmazonActivityPeriod_(
        String(rawPeriod).trim()
      );

    if (!parsedPeriod) {
      return createPeriodError_(
        "INVALID_PERIOD_VALUE"
      );
    }

    addUniquePeriod_(
      uniquePeriods,
      parsedPeriod
    );
  }

  if (!matchingRowsFound) {
    return createPeriodError_(
      "NO_MATCHING_FILTER_ROWS"
    );
  }

  return buildReportPeriod_(
    Array.from(
      uniquePeriods.values()
    )
  );
}

/**
 * Определяет период Allegro sales report.
 *
 * Формат даты:
 * dd.MM.yyyy HH:mm
 *
 * Пример:
 * 31.07.2026 02:20
 *
 * Анализируются все строки.
 *
 * @param {string[][]} values
 * @param {Object} rule
 * @return {Object}
 */
function determineAllegroReportPeriod_(
  values,
  rule
) {
  const headerRow =
    values[rule.headerRowIndex];

  if (!Array.isArray(headerRow)) {
    return createPeriodError_(
      "HEADER_ROW_NOT_FOUND"
    );
  }

  const dateColumnIndex =
    findHeaderIndex_(
      headerRow,
      rule.periodColumn
    );

  if (dateColumnIndex === -1) {
    return createPeriodError_(
      "PERIOD_COLUMN_NOT_FOUND"
    );
  }

  const uniquePeriods =
    new Map();

  let dataRowsFound = false;

  for (
    let rowIndex =
      rule.headerRowIndex + 1;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const row =
      Array.isArray(values[rowIndex])
        ? values[rowIndex]
        : [];

    const rawDate =
      row[dateColumnIndex];

    if (
      rawDate === "" ||
      rawDate === null ||
      typeof rawDate === "undefined"
    ) {
      continue;
    }

    dataRowsFound = true;

    const parsedPeriod =
      parseAllegroDate_(
        String(rawDate).trim()
      );

    if (!parsedPeriod) {
      return createPeriodError_(
        "INVALID_ALLEGRO_DATE"
      );
    }

    addUniquePeriod_(
      uniquePeriods,
      parsedPeriod
    );
  }

  if (!dataRowsFound) {
    return createPeriodError_(
      "NO_PERIOD_VALUES"
    );
  }

  return buildReportPeriod_(
    Array.from(
      uniquePeriods.values()
    )
  );
}

/**
 * Разбирает дату Allegro.
 *
 * Строгий формат:
 * dd.MM.yyyy HH:mm
 *
 * @param {string} value
 * @return {Object|null}
 */
function parseAllegroDate_(value) {
  const match =
    String(value).match(
      /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/
    );

  if (!match) {
    return null;
  }

  const day =
    Number(match[1]);

  const monthNumber =
    Number(match[2]);

  const year =
    Number(match[3]);

  const hour =
    Number(match[4]);

  const minute =
    Number(match[5]);

  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 9999 ||
    !Number.isInteger(monthNumber) ||
    monthNumber < 1 ||
    monthNumber > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31 ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  /**
   * Проверяем, что календарная дата существует.
   */
  const date =
    new Date(
      Date.UTC(
        year,
        monthNumber - 1,
        day,
        hour,
        minute
      )
    );

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !==
      monthNumber - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) {
    return null;
  }

  const month =
    getReportMonthByNumber_(
      monthNumber
    );

  if (!month) {
    return null;
  }

  return {
    year: year,
    month: month
  };
}

/**
 * Добавляет уникальную комбинацию год + месяц.
 *
 * @param {Map} uniquePeriods
 * @param {Object} parsedPeriod
 */
function addUniquePeriod_(
  uniquePeriods,
  parsedPeriod
) {
  const uniqueKey =
    parsedPeriod.year +
    "-" +
    parsedPeriod.month.numberText;

  uniquePeriods.set(
    uniqueKey,
    parsedPeriod
  );
}


/**
 * Формирует период:
 *
 * 1 месяц:
 * 2026.07 July
 *
 * Полный квартал:
 * 2026.Q3
 *
 * @param {Object[]} periods
 * @return {Object}
 */
function buildReportPeriod_(periods) {
  if (
    !Array.isArray(periods) ||
    periods.length === 0
  ) {
    return createPeriodError_(
      "NO_PERIOD_VALUES"
    );
  }

  /**
   * Один месяц.
   */
  if (periods.length === 1) {
    const period =
      periods[0];

    return {
      success: true,

      period:
        period.year +
        "." +
        period.month.numberText +
        " " +
        period.month.fullName,

      reason: null
    };
  }

  /**
   * Для квартала должно быть
   * ровно три уникальных месяца.
   */
  if (periods.length !== 3) {
    return createPeriodError_(
      "INVALID_NUMBER_OF_MONTHS"
    );
  }

  const years =
    new Set(
      periods.map(function (period) {
        return period.year;
      })
    );

  if (years.size !== 1) {
    return createPeriodError_(
      "MULTIPLE_YEARS"
    );
  }

  const quarters =
    new Set(
      periods.map(function (period) {
        return period.month.quarter;
      })
    );

  if (quarters.size !== 1) {
    return createPeriodError_(
      "MULTIPLE_QUARTERS"
    );
  }

  const year =
    periods[0].year;

  const quarter =
    periods[0].month.quarter;

  const actualMonthNumbers =
    periods
      .map(function (period) {
        return period.month.number;
      })
      .sort(function (a, b) {
        return a - b;
      });

  const expectedMonthNumbers =
    getQuarterMonths_(
      quarter
    );

  const isFullQuarter =
    expectedMonthNumbers.every(
      function (
        monthNumber,
        index
      ) {
        return (
          actualMonthNumbers[index] ===
          monthNumber
        );
      }
    );

  if (!isFullQuarter) {
    return createPeriodError_(
      "INCOMPLETE_QUARTER"
    );
  }

  return {
    success: true,
    period:
      year + ".Q" + quarter,
    reason: null
  };
}


/**
 * Находит объект месяца по номеру.
 *
 * @param {number} monthNumber
 * @return {Object|null}
 */
function getReportMonthByNumber_(
  monthNumber
) {
  const months =
    Object.values(
      REPORT_MONTHS
    );

  for (
    let index = 0;
    index < months.length;
    index += 1
  ) {
    if (
      months[index].number ===
      monthNumber
    ) {
      return months[index];
    }
  }

  return null;
}

/**
 * Формат Amazon:
 * 2026-May, 2026-MAY или 2026-may.
 *
 * @param {string} value
 * @return {Object|null}
 */
function parseAmazonActivityPeriod_(value) {
  const match = String(value).match(
    /^(\d{4})-([A-Za-z]{3})$/
  );

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthKey =
    match[2].toUpperCase();

  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 9999
  ) {
    return null;
  }

  const month =
    REPORT_MONTHS[monthKey];

  if (!month) {
    return null;
  }

  return {
    year,
    month
  };
}


/**
 * @param {Array<*>} headerRow
 * @param {string} requiredHeader
 * @return {number}
 */
function findHeaderIndex_(
  headerRow,
  requiredHeader
) {
  const expected = normalizeHeader_(
    requiredHeader,
    false
  );

  for (
    let index = 0;
    index < headerRow.length;
    index += 1
  ) {
    const actual = normalizeHeader_(
      headerRow[index],
      index === 0
    );

    if (actual === expected) {
      return index;
    }
  }

  return -1;
}


/**
 * BOM удаляется только из первой ячейки.
 *
 * @param {*} value
 * @param {boolean} removeBom
 * @return {string}
 */
function normalizeHeader_(
  value,
  removeBom
) {
  let normalized = String(
    value === null ||
    typeof value === "undefined"
      ? ""
      : value
  );

  if (removeBom) {
    normalized =
      normalized.replace(/^\uFEFF/, "");
  }

  return normalized
  .trim()
  .toUpperCase();
}


/**
 * @param {number} quarter
 * @return {number[]}
 */
function getQuarterMonths_(quarter) {
  const firstMonth =
    (quarter - 1) * 3 + 1;

  return [
    firstMonth,
    firstMonth + 1,
    firstMonth + 2
  ];
}


/**
 * @param {string} reason
 * @return {Object}
 */
function createPeriodError_(reason) {
  return {
    success: false,
    period: null,
    reason
  };
}


/**
 * @return {Object}
 */
function createUndefinedClassification_(
  status,
  typeDetected,
  technicalReason,
  warning
) {
  return {
    classified: false,
    typeDetected: Boolean(typeDetected),
    type: "undefined",
    period: "undefined",
    folderId: null,
    status,
    technicalReason,
    warning
  };
}