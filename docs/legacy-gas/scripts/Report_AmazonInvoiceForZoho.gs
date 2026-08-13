/**
 * Report_AmazonInvoiceForZoho.gs
 *
 * Создаёт отчёт Amazon invoice for Zoho.
 *
 * Общая инфраструктура Code.gs до вызова этой функции:
 * - проверяет, что выбран месячный период;
 * - проверяет наличие Amazon Monthly Transaction report
 *   для ES, IT, FR, DE, UK, SE, PL, NL, IE, BE;
 * - для каждой страны передаёт в context.sourceReports
 *   последнюю доступную версию отчёта за выбранный месяц;
 * - создаёт папку результата.
 *
 * Текущая версия:
 * - создаёт один Google Spreadsheet;
 * - создаёт основной лист "Amazon invoice for Zoho";
 * - считает Unit Price прямо на country-листах;
 * - агрегирует одну страну за раз по SKU + Unit Price;
 * - сразу переносит агрегированный результат в основной лист;
 * - заполняет Invoice Date, Invoice Number, Customer Name,
 *   Item Name, SKU, Quantity и Item Price;
 * - остальные поля пока оставляет пустыми;
 * - копирует Amazon Monthly Transaction report каждой страны
 *   в отдельный дополнительный лист ES / IT / FR / DE / UK /
 *   SE / PL / NL / IE / BE.
 */

const AMAZON_INVOICE_RUNTIME = Object.freeze({
  reportName: "Amazon invoice for Zoho",
  outputSheetName: "Amazon invoice for Zoho",
  invoiceDateFormat: "dd/MM/yyyy",
  unitPriceHeader: "Unit Price",
  priceDecimals: 2
});


/**
 * Главная функция генерации.
 *
 * @param {{
 *   reportType: string,
 *   period: string,
 *   sourceReports: Object,
 *   destinationFolderId: string
 * }} context
 *
 * @returns {{
 *   createdFiles: number,
 *   processedRows: number,
 *   skippedRows: number
 * }}
 */
function generateAmazonInvoiceForZoho(context) {
  validateAmazonInvoiceForZohoContext_(context);

  const periodInfo =
    parseAmazonInvoiceForZohoPeriod_(
      context.period
    );

  const destinationFolder =
    getAmazonInvoiceForZohoDestinationFolder_(
      context.destinationFolderId
    );

  const spreadsheetName =
    AMAZON_INVOICE_RUNTIME.reportName +
    " - " +
    context.period;

  let spreadsheet = null;
  let spreadsheetFile = null;

  try {
    spreadsheet =
      SpreadsheetApp.create(
        spreadsheetName
      );

    spreadsheetFile =
      DriveApp.getFileById(
        spreadsheet.getId()
      );

    spreadsheetFile.moveTo(
      destinationFolder
    );

    const outputSheet =
      spreadsheet.getSheets()[0];

    outputSheet.setName(
      AMAZON_INVOICE_RUNTIME
        .outputSheetName
    );

    const countrySheetStats =
      copyAmazonMonthlyCountrySheets_(
        spreadsheet,
        context.sourceReports
      );

    SpreadsheetApp.flush();

    /**
     * Для каждого country-листа:
     * 1) добавляем Unit Price;
     * 2) считаем Unit Price формулой прямо в Google Sheet;
     * 3) агрегируем только нужные 3 колонки одной страны
     *    (SKU + Unit Price + Amount);
     * 4) сразу записываем результат в основной Zoho-лист.
     *
     * Отдельная агрегированная таблица на country-листах не создаётся.
     */
    prepareAmazonInvoiceUnitPriceColumns_(
      spreadsheet
    );

    SpreadsheetApp.flush();

    const invoiceRows =
      fillAmazonInvoiceForZohoFromCountrySheets_(
        spreadsheet,
        outputSheet,
        periodInfo
      );

    SpreadsheetApp.flush();

    return {
      createdFiles: 1,
      processedRows:
        countrySheetStats.processedRows,
      skippedRows:
        countrySheetStats.skippedRows,
      invoiceRows:
        invoiceRows
    };
  } catch (error) {
    if (spreadsheetFile) {
      try {
        spreadsheetFile.setTrashed(
          true
        );
      } catch (cleanupError) {
        console.error(
          "Failed to remove incomplete Amazon invoice for Zoho file:",
          cleanupError
        );
      }
    }

    throw new Error(
      "The Amazon invoice for Zoho file could not be created. " +
      getAmazonInvoiceForZohoErrorMessage_(
        error
      )
    );
  }
}


/**
 * Заполняет основной лист "Amazon invoice for Zoho" напрямую
 * из country-листов после расчёта Unit Price.
 *
 * Для каждой страны:
 * - читаются только SKU, Amount и Unit Price;
 * - данные агрегируются по SKU + Unit Price;
 * - результат сразу записывается на основной лист;
 * - после этого память для этой страны освобождается.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {GoogleAppsScript.Spreadsheet.Sheet} outputSheet
 * @param {{
 *   year: number,
 *   month: number,
 *   monthText: string,
 *   shortYear: string,
 *   lastDay: Date
 * }} periodInfo
 * @returns {number}
 */
function fillAmazonInvoiceForZohoFromCountrySheets_(
  spreadsheet,
  outputSheet,
  periodInfo
) {
  const headers =
    AMAZON_INVOICE_OUTPUT_HEADERS;

  ensureAmazonInvoiceForZohoSheetSize_(
    outputSheet,
    2,
    headers.length
  );

  outputSheet.clearContents();

  outputSheet
    .getRange(
      1,
      1,
      1,
      headers.length
    )
    .setValues([
      headers
    ]);

  let nextOutputRow = 2;
  let invoiceRows = 0;

  /**
   * Получаем курсы Google Finance один раз на весь отчёт.
   * В итоговые ячейки затем записываются обычные числовые значения,
   * а не формулы.
   */
  const exchangeRates =
    getAmazonInvoiceExchangeRates_(
      spreadsheet
    );

  AMAZON_INVOICE_COUNTRIES
    .forEach(
      function (countryCode) {
        const countrySheet =
          spreadsheet.getSheetByName(
            countryCode
          );

        if (!countrySheet) {
          throw new Error(
            "The country sheet " +
            countryCode +
            " was not found."
          );
        }

        const countrySales =
          aggregateAmazonCountrySheetForInvoice_(
            countrySheet,
            countryCode
          );

        if (
          countrySales.length === 0
        ) {
          return;
        }

        const outputRows =
          countrySales
            .filter(
              function (sale) {
                return !isAmazonInvoiceIgnoredSku_(
                  sale.amazonSku
                );
              }
            )
            .map(
              function (sale) {
                const mapping =
                  getAmazonInvoiceSkuMapping_(
                    sale.amazonSku
                  );

              return [
                periodInfo.lastDay,

                buildAmazonInvoiceForZohoInvoiceNumber_(
                  countryCode,
                  periodInfo
                ),

                buildAmazonInvoiceForZohoCustomerName_(
                  countryCode
                ),

                getAmazonInvoiceCurrencyCode_(
                  countryCode
                ),

                getAmazonInvoiceExchangeRate_(
                  countryCode,
                  exchangeRates
                ),

                mapping.itemName,

                mapping.invoiceSku,

                "", // Item Desc

                sale.quantity,

                sale.unitPrice,

                getAmazonInvoiceAccount_(
                  countryCode
                )
              ];
            }
          );

        ensureAmazonInvoiceForZohoSheetSize_(
          outputSheet,
          nextOutputRow +
            outputRows.length -
            1,
          headers.length
        );

        outputSheet
          .getRange(
            nextOutputRow,
            1,
            outputRows.length,
            headers.length
          )
          .setValues(
            outputRows
          );

        nextOutputRow +=
          outputRows.length;

        invoiceRows +=
          outputRows.length;
      }
    );

  if (invoiceRows > 0) {
    outputSheet
      .getRange(
        2,
        1,
        invoiceRows,
        1
      )
      .setNumberFormat(
        AMAZON_INVOICE_RUNTIME
          .invoiceDateFormat
      );

    outputSheet
      .getRange(
        2,
        9,
        invoiceRows,
        1
      )
      .setNumberFormat(
        "0.######"
      );

    outputSheet
      .getRange(
        2,
        10,
        invoiceRows,
        1
      )
      .setNumberFormat(
        "0.00"
      );
  }

  outputSheet.setFrozenRows(1);

  return invoiceRows;
}


/**
 * Возвращает true, если SKU нужно полностью исключить
 * из итогового Zoho invoice.
 */
function isAmazonInvoiceIgnoredSku_(
  amazonSku
) {
  return AMAZON_INVOICE_IGNORED_SKUS
    .indexOf(
      String(
        amazonSku || ""
      ).trim()
    ) !== -1;
}


/**
 * Возвращает SKU/Item Name для итогового invoice.
 * Для SKU без mapping оставляет исходный Amazon SKU.
 */
function getAmazonInvoiceSkuMapping_(
  amazonSku
) {
  const mappings =
    AMAZON_INVOICE_SKU_MAPPINGS;

  const mapping =
    mappings[
      amazonSku
    ];

  if (!mapping) {
    return {
      invoiceSku:
        amazonSku,
      itemName:
        ""
    };
  }

  return {
    invoiceSku:
      String(
        mapping.invoiceSku ||
        amazonSku
      ).trim(),

    itemName:
      String(
        mapping.itemName ||
        ""
      ).trim()
  };
}


/**
 * Currency Code для Zoho invoice:
 * - PL -> PLN
 * - UK -> GBP
 * - SE -> SEK
 * - остальные Amazon marketplaces -> EUR
 *
 * @param {string} countryCode
 * @returns {string}
 */
function getAmazonInvoiceCurrencyCode_(
  countryCode
) {
  switch (
    String(
      countryCode || ""
    ).trim()
  ) {
    case "PL":
      return "PLN";

    case "UK":
      return "GBP";

    case "SE":
      return "SEK";

    default:
      return "EUR";
  }
}


/**
 * Получает необходимые курсы через GOOGLEFINANCE один раз на весь отчёт.
 *
 * Временный технический лист создаётся только на время расчёта:
 * - PLN -> EUR
 * - GBP -> EUR
 * - SEK -> EUR
 *
 * После SpreadsheetApp.flush() числовые значения считываются,
 * временный лист удаляется, а в итоговый invoice записываются
 * уже обычные числа.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {{EUR:number,PLN:number,GBP:number,SEK:number}}
 */
function getAmazonInvoiceExchangeRates_(
  spreadsheet
) {
  const tempSheetName =
    "__amazon_fx_" +
    new Date().getTime();

  let tempSheet = null;

  try {
    tempSheet =
      spreadsheet.insertSheet(
        tempSheetName
      );

    /**
     * GOOGLEFINANCE вызывается всего по одному разу
     * на каждую реально нужную не-EUR валюту.
     */
    tempSheet
      .getRange(
        1,
        1,
        3,
        1
      )
      .setFormulas([
        [
          '=GOOGLEFINANCE("CURRENCY:PLNEUR")'
        ],
        [
          '=GOOGLEFINANCE("CURRENCY:GBPEUR")'
        ],
        [
          '=GOOGLEFINANCE("CURRENCY:SEKEUR")'
        ]
      ]);

    SpreadsheetApp.flush();

    const values =
      tempSheet
        .getRange(
          1,
          1,
          3,
          1
        )
        .getValues();

    const rates = {
      EUR: 1,

      PLN:
        validateAmazonInvoiceExchangeRate_(
          values[0][0],
          "PLN"
        ),

      GBP:
        validateAmazonInvoiceExchangeRate_(
          values[1][0],
          "GBP"
        ),

      SEK:
        validateAmazonInvoiceExchangeRate_(
          values[2][0],
          "SEK"
        )
    };

    return rates;
  } finally {
    if (tempSheet) {
      try {
        spreadsheet.deleteSheet(
          tempSheet
        );
      } catch (cleanupError) {
        console.error(
          "Failed to remove temporary FX sheet:",
          cleanupError
        );
      }
    }
  }
}


/**
 * Возвращает уже рассчитанное числовое значение Exchange Rate.
 *
 * @param {string} countryCode
 * @param {{EUR:number,PLN:number,GBP:number,SEK:number}} exchangeRates
 * @returns {number}
 */
function getAmazonInvoiceExchangeRate_(
  countryCode,
  exchangeRates
) {
  const currencyCode =
    getAmazonInvoiceCurrencyCode_(
      countryCode
    );

  const rate =
    exchangeRates[
      currencyCode
    ];

  if (
    typeof rate !== "number" ||
    !Number.isFinite(rate) ||
    rate <= 0
  ) {
    throw new Error(
      "Exchange rate for " +
      currencyCode +
      " is missing or invalid."
    );
  }

  return rate;
}


/**
 * Проверяет числовой результат GOOGLEFINANCE.
 *
 * @param {*} value
 * @param {string} currencyCode
 * @returns {number}
 */
function validateAmazonInvoiceExchangeRate_(
  value,
  currencyCode
) {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
  ) {
    return value;
  }

  throw new Error(
    "Google Finance did not return a valid " +
    currencyCode +
    " -> EUR exchange rate."
  );
}


/**
 * Account для итогового Zoho invoice.
 *
 * Регистр важен:
 * SE -> Amazon Sales SE
 * DE -> Amazon Sales DE
 * UK -> Amazon Sales UK
 * и т.д.
 *
 * @param {string} countryCode
 * @returns {string}
 */
function getAmazonInvoiceAccount_(
  countryCode
) {
  return (
    "Amazon Sales " +
    String(
      countryCode || ""
    ).trim()
  );
}


/**
 * Invoice Number:
 *
 * INV-Amz DE-01.25
 *
 * Где:
 * - DE — код Amazon marketplace;
 * - 01 — месяц;
 * - 25 — две последние цифры года.
 *
 * @param {string} countryCode
 * @param {{monthText: string, shortYear: string}} periodInfo
 * @returns {string}
 */
function buildAmazonInvoiceForZohoInvoiceNumber_(
  countryCode,
  periodInfo
) {
  return (
    "INV-Amz " +
    countryCode +
    "-" +
    periodInfo.monthText +
    "." +
    periodInfo.shortYear
  );
}


/**
 * Customer Name:
 *
 * Amazon DE
 * Amazon UK
 * Amazon ES
 * и т.д.
 *
 * @param {string} countryCode
 * @returns {string}
 */
function buildAmazonInvoiceForZohoCustomerName_(
  countryCode
) {
  return (
    "Amazon " +
    countryCode
  );
}


/**
 * Создаёт country-листы из Amazon Monthly Transaction reports.
 * Сохраняет header и только обычные продажи/заказы.
 * Строки с Product Sales = 0 (с учётом округления до 2 знаков)
 * вообще не импортируются в country-листы.
 */
function copyAmazonMonthlyCountrySheets_(
  destinationSpreadsheet,
  sourceReports
) {
  let processedRows = 0;
  let skippedRows = 0;

  AMAZON_INVOICE_COUNTRIES
    .forEach(
      function (countryCode) {
        const sourceReference =
          sourceReports[countryCode];

        if (
          !sourceReference ||
          !sourceReference.sourceSpreadsheetId
        ) {
          throw new Error(
            "The Amazon Monthly Transaction source report for " +
            countryCode +
            " is missing."
          );
        }

        const sourceSpreadsheet =
          openAmazonInvoiceForZohoSourceSpreadsheet_(
            sourceReference.sourceSpreadsheetId,
            countryCode
          );

        const sourceSheets =
          sourceSpreadsheet.getSheets();

        if (sourceSheets.length !== 1) {
          throw new Error(
            "The Amazon Monthly Transaction report for " +
            countryCode +
            " must contain exactly one sheet. " +
            "The selected source contains " +
            sourceSheets.length +
            " sheets."
          );
        }

        const sourceSheet =
          sourceSheets[0];

        const lastRow =
          sourceSheet.getLastRow();

        const lastColumn =
          sourceSheet.getLastColumn();

        if (lastRow < 1) {
          throw new Error(
            "The Amazon Monthly Transaction report for " +
            countryCode +
            " is empty."
          );
        }

        if (lastColumn < 3) {
          throw new Error(
            "The Amazon Monthly Transaction report for " +
            countryCode +
            " does not contain column C (transaction type)."
          );
        }

        const sourceValues =
          sourceSheet
            .getRange(
              1,
              1,
              lastRow,
              lastColumn
            )
            .getValues();

        const header =
          sourceValues[0];

        const allowedType =
          AMAZON_INVOICE_ORDER_TYPES[countryCode];

        if (!allowedType) {
          throw new Error(
            "The order type configuration for " +
            countryCode +
            " is missing."
          );
        }

        const countryColumns =
          AMAZON_INVOICE_SOURCE_COLUMNS[
            countryCode
          ];

        if (!countryColumns) {
          throw new Error(
            "Source column configuration for " +
            countryCode +
            " is missing."
          );
        }

        const productSalesColumnIndex =
          findAmazonInvoiceAggregationColumn_(
            header,
            countryColumns.productSales,
            countryCode,
            "Product Sales"
          );

        const filteredRows = [];

        for (
          let rowIndex = 1;
          rowIndex < sourceValues.length;
          rowIndex += 1
        ) {
          const row =
            sourceValues[rowIndex];

          const isEmpty =
            row.every(
              function (value) {
                return (
                  value === "" ||
                  value === null
                );
              }
            );

          if (isEmpty) {
            skippedRows += 1;
            continue;
          }

          const transactionType =
            String(
              row[2] === null ||
              typeof row[2] === "undefined"
                ? ""
                : row[2]
            ).trim();

          if (transactionType !== allowedType) {
            skippedRows += 1;
            continue;
          }

          const productSales =
            parseAmazonInvoiceAggregationNumber_(
              row[
                productSalesColumnIndex
              ],
              countryCode,
              "Product Sales",
              rowIndex + 1
            );

          /**
           * Product Sales — денежное поле, поэтому для фильтра
           * приводим его к той же точности, с которой работаем
           * с ценой в отчёте.
           *
           * Строка НЕ импортируется на country-лист, если
           * Product Sales после округления до 2 знаков = 0.
           *
           * Это покрывает:
           * - 0
           * - 0.00
           * - "0,00"
           * - -0
           * - очень маленькие значения, которые фактически
           *   отображаются как 0.00
           *
           * Название колонки для каждой страны берётся из
           * AMAZON_INVOICE_SOURCE_COLUMNS:
           * ventas de productos / Vendite / Umsätze /
           * product sales / и т.д.
           */
          const normalizedProductSales =
            roundAmazonInvoiceAggregationNumber_(
              productSales,
              AMAZON_INVOICE_RUNTIME
                .priceDecimals
            );

          if (normalizedProductSales === 0) {
            skippedRows += 1;
            continue;
          }

          filteredRows.push(row);
          processedRows += 1;
        }

        const existingSheet =
          destinationSpreadsheet.getSheetByName(
            countryCode
          );

        if (existingSheet) {
          destinationSpreadsheet.deleteSheet(
            existingSheet
          );
        }

        const destinationSheet =
          destinationSpreadsheet.insertSheet(
            countryCode
          );

        const outputValues =
          [header].concat(filteredRows);

        ensureAmazonInvoiceForZohoSheetSize_(
          destinationSheet,
          outputValues.length,
          lastColumn
        );

        destinationSheet
          .getRange(
            1,
            1,
            outputValues.length,
            lastColumn
          )
          .setValues(outputValues);

        destinationSheet.setFrozenRows(1);
      }
    );

  return {
    processedRows: processedRows,
    skippedRows: skippedRows
  };
}


/**
 * Разбирает период вида:
 * 2026.07 July
 *
 * Возвращает также последний календарный день месяца.
 *
 * @param {string} period
 * @returns {{
 *   year: number,
 *   month: number,
 *   monthText: string,
 *   shortYear: string,
 *   lastDay: Date
 * }}
 */
function parseAmazonInvoiceForZohoPeriod_(
  period
) {
  const value =
    String(
      period || ""
    ).trim();

  const match =
    value.match(
      /^(\d{4})\.(0[1-9]|1[0-2])\s+[A-Za-z]+$/
    );

  if (!match) {
    throw new Error(
      'Amazon invoice for Zoho requires a monthly period in the format "YYYY.MM Month", for example "2026.07 July".'
    );
  }

  const year =
    Number(
      match[1]
    );

  const month =
    Number(
      match[2]
    );

  const lastDay =
    new Date(
      year,
      month,
      0
    );

  return {
    year: year,

    month: month,

    monthText:
      String(month)
        .padStart(
          2,
          "0"
        ),

    shortYear:
      String(year)
        .slice(-2),

    lastDay:
      lastDay
  };
}


/**
 * Проверяет входной context.
 *
 * @param {Object} context
 */
function validateAmazonInvoiceForZohoContext_(
  context
) {
  if (
    !context ||
    typeof context !== "object"
  ) {
    throw new Error(
      "The Amazon invoice for Zoho context is missing."
    );
  }

  [
    "period",
    "destinationFolderId"
  ].forEach(
    function (field) {
      if (
        !String(
          context[field] || ""
        ).trim()
      ) {
        throw new Error(
          'The required report parameter "' +
          field +
          '" is missing.'
        );
      }
    }
  );

  if (
    !context.sourceReports ||
    typeof context.sourceReports !==
      "object"
  ) {
    throw new Error(
      "The Amazon Monthly Transaction source reports are missing."
    );
  }

  const missingCountries =
    AMAZON_INVOICE_COUNTRIES
      .filter(
        function (countryCode) {
          const source =
            context.sourceReports[
              countryCode
            ];

          return (
            !source ||
            !source
              .sourceSpreadsheetId
          );
        }
      );

  if (
    missingCountries.length > 0
  ) {
    throw new Error(
      "Missing Amazon Monthly Transaction reports for countries:\n- " +
      missingCountries.join(
        "\n- "
      )
    );
  }
}


/**
 * Открывает исходный Google Spreadsheet.
 *
 * @param {string} spreadsheetId
 * @param {string} countryCode
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function openAmazonInvoiceForZohoSourceSpreadsheet_(
  spreadsheetId,
  countryCode
) {
  try {
    return SpreadsheetApp.openById(
      spreadsheetId
    );
  } catch (error) {
    throw new Error(
      "The Amazon Monthly Transaction Google Sheet for " +
      countryCode +
      " could not be opened. Check that the file exists " +
      "and that you have access to it."
    );
  }
}


/**
 * Получает destination folder.
 *
 * @param {string} folderId
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function getAmazonInvoiceForZohoDestinationFolder_(
  folderId
) {
  try {
    return DriveApp.getFolderById(
      folderId
    );
  } catch (error) {
    throw new Error(
      "The Amazon invoice for Zoho destination folder could not be opened."
    );
  }
}


/**
 * Увеличивает лист при необходимости.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} requiredRows
 * @param {number} requiredColumns
 */
function ensureAmazonInvoiceForZohoSheetSize_(
  sheet,
  requiredRows,
  requiredColumns
) {
  const currentRows =
    sheet.getMaxRows();

  const currentColumns =
    sheet.getMaxColumns();

  if (
    requiredRows >
    currentRows
  ) {
    sheet.insertRowsAfter(
      currentRows,
      requiredRows -
        currentRows
    );
  }

  if (
    requiredColumns >
    currentColumns
  ) {
    sheet.insertColumnsAfter(
      currentColumns,
      requiredColumns -
        currentColumns
    );
  }
}


/**
 * Возвращает читаемый текст ошибки.
 *
 * @param {*} error
 * @returns {string}
 */
function getAmazonInvoiceForZohoErrorMessage_(
  error
) {
  if (
    error &&
    typeof error.message ===
      "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }

  return "An unexpected error occurred.";
}


/* ==============================
 * Country sheet processing
 * ============================== */

function prepareAmazonInvoiceUnitPriceColumns_(
  spreadsheet
) {
  AMAZON_INVOICE_COUNTRIES
    .forEach(
      function (countryCode) {
        const sheet =
          spreadsheet.getSheetByName(
            countryCode
          );

        if (!sheet) {
          throw new Error(
            "The country sheet " +
            countryCode +
            " was not found."
          );
        }

        addAmazonInvoiceUnitPriceColumn_(
          sheet,
          countryCode
        );

        SpreadsheetApp.flush();
      }
    );
}


/**
 * Добавляет колонку Unit Price сразу после исходных колонок.
 * Если она уже существует, использует существующую.
 */
function addAmazonInvoiceUnitPriceColumn_(
  sheet,
  countryCode
) {
  const lastRow =
    sheet.getLastRow();

  const lastColumn =
    sheet.getLastColumn();

  if (lastRow < 1) {
    throw new Error(
      "The " +
      countryCode +
      " sheet is empty."
    );
  }

  const headers =
    sheet
      .getRange(
        1,
        1,
        1,
        lastColumn
      )
      .getValues()[0];

  const countryConfig =
    AMAZON_INVOICE_SOURCE_COLUMNS[
        countryCode
      ];

  if (!countryConfig) {
    throw new Error(
      "Aggregation column configuration for " +
      countryCode +
      " is missing."
    );
  }

  const amountColumnIndex =
    findAmazonInvoiceAggregationColumn_(
      headers,
      countryConfig.amount,
      countryCode,
      "Amount"
    );

  const productSalesColumnIndex =
    findAmazonInvoiceAggregationColumn_(
      headers,
      countryConfig.productSales,
      countryCode,
      "Product Sales"
    );

  let unitPriceColumnIndex =
    findAmazonInvoiceAggregationColumnOptional_(
      headers,
      [
        AMAZON_INVOICE_RUNTIME
          .unitPriceHeader
      ]
    );

  let unitPriceColumn;

  if (
    unitPriceColumnIndex === -1
  ) {
    unitPriceColumn =
      lastColumn + 1;

    ensureAmazonInvoiceAggregationSheetSize_(
      sheet,
      Math.max(
        lastRow,
        2
      ),
      unitPriceColumn
    );

    sheet
      .getRange(
        1,
        unitPriceColumn
      )
      .setValue(
        AMAZON_INVOICE_RUNTIME
          .unitPriceHeader
      );
  } else {
    unitPriceColumn =
      unitPriceColumnIndex + 1;
  }

  if (lastRow <= 1) {
    return;
  }

  /**
   * Unit Price считаем формулой прямо в Google Sheet.
   *
   * Формула специально НЕ содержит:
   * - ROUND();
   * - IFERROR();
   * - десятичных констант;
   * - разделителей аргументов "," или ";".
   *
   * Поэтому она не зависит от locale файла.
   *
   * Пример R1C1:
   * =RC[-16]/RC[-23]
   *
   * Визуально колонка показывается с 2 знаками через Number Format.
   * При последующей группировке значение дополнительно округляется
   * до priceDecimals в Apps Script, поэтому ключ SKU + Unit Price
   * остаётся стабильным.
   */
  const productSalesOffset =
    productSalesColumnIndex +
      1 -
      unitPriceColumn;

  const amountOffset =
    amountColumnIndex +
      1 -
      unitPriceColumn;

  const formulaR1C1 =
    "=RC[" +
    productSalesOffset +
    "]/RC[" +
    amountOffset +
    "]";

  sheet
    .getRange(
      2,
      unitPriceColumn,
      lastRow - 1,
      1
    )
    .setFormulaR1C1(
      formulaR1C1
    )
    .setNumberFormat(
      "0.00"
    );
}


/**
 * Читает только SKU, Amount и Unit Price одной страны,
 * агрегирует и сразу возвращает небольшой summary.
 *
 * В памяти нет всех стран одновременно.
 *
 * @returns {Array<{amazonSku:string,quantity:number,unitPrice:number}>}
 */
function aggregateAmazonCountrySheetForInvoice_(
  sheet,
  countryCode
) {
  const lastRow =
    sheet.getLastRow();

  const lastColumn =
    sheet.getLastColumn();

  if (lastRow <= 1) {
    return [];
  }

  const headers =
    sheet
      .getRange(
        1,
        1,
        1,
        lastColumn
      )
      .getValues()[0];

  const countryConfig =
    AMAZON_INVOICE_SOURCE_COLUMNS[
        countryCode
      ];

  if (!countryConfig) {
    throw new Error(
      "Aggregation column configuration for " +
      countryCode +
      " is missing."
    );
  }

  const skuColumnIndex =
    findAmazonInvoiceAggregationColumn_(
      headers,
      countryConfig.sku,
      countryCode,
      "SKU"
    );

  const amountColumnIndex =
    findAmazonInvoiceAggregationColumn_(
      headers,
      countryConfig.amount,
      countryCode,
      "Amount"
    );

  const unitPriceColumnIndex =
    findAmazonInvoiceAggregationColumn_(
      headers,
      [
        AMAZON_INVOICE_RUNTIME
          .unitPriceHeader
      ],
      countryCode,
      "Unit Price"
    );

  /**
   * Читаем только три нужных диапазона вместо всего листа.
   */
  const skuValues =
    sheet
      .getRange(
        2,
        skuColumnIndex + 1,
        lastRow - 1,
        1
      )
      .getValues();

  const amountValues =
    sheet
      .getRange(
        2,
        amountColumnIndex + 1,
        lastRow - 1,
        1
      )
      .getValues();

  const unitPriceValues =
    sheet
      .getRange(
        2,
        unitPriceColumnIndex + 1,
        lastRow - 1,
        1
      )
      .getValues();

  const groups =
    new Map();

  for (
    let rowIndex = 0;
    rowIndex < skuValues.length;
    rowIndex += 1
  ) {
    const sheetRowNumber =
      rowIndex + 2;

    const amazonSku =
      String(
        skuValues[
          rowIndex
        ][0] === null ||
        typeof skuValues[
          rowIndex
        ][0] ===
          "undefined"
          ? ""
          : skuValues[
              rowIndex
            ][0]
      ).trim();

    if (!amazonSku) {
      throw new Error(
        "The " +
        countryCode +
        " sheet contains an empty SKU in row " +
        sheetRowNumber +
        "."
      );
    }

    const quantity =
      parseAmazonInvoiceAggregationNumber_(
        amountValues[
          rowIndex
        ][0],
        countryCode,
        "Amount",
        sheetRowNumber
      );

    if (quantity <= 0) {
      throw new Error(
        "The " +
        countryCode +
        " sheet contains invalid Amount in row " +
        sheetRowNumber +
        "."
      );
    }

    const unitPrice =
      parseAmazonInvoiceAggregationNumber_(
        unitPriceValues[
          rowIndex
        ][0],
        countryCode,
        "Unit Price",
        sheetRowNumber
      );

    if (unitPrice < 0) {
      throw new Error(
        "The " +
        countryCode +
        " sheet contains negative Unit Price in row " +
        sheetRowNumber +
        "."
      );
    }

    const normalizedUnitPrice =
      roundAmazonInvoiceAggregationNumber_(
        unitPrice,
        AMAZON_INVOICE_RUNTIME
          .priceDecimals
      );

    const groupKey =
      amazonSku +
      "\\u0001" +
      normalizedUnitPrice.toFixed(
        AMAZON_INVOICE_RUNTIME
          .priceDecimals
      );

    if (
      groups.has(
        groupKey
      )
    ) {
      const existing =
        groups.get(
          groupKey
        );

      existing.quantity =
        roundAmazonInvoiceAggregationNumber_(
          existing.quantity +
            quantity,
          6
        );
    } else {
      groups.set(
        groupKey,
        {
          amazonSku:
            amazonSku,
          quantity:
            quantity,
          unitPrice:
            normalizedUnitPrice
        }
      );
    }
  }

  return Array.from(
    groups.values()
  );
}


function findAmazonInvoiceAggregationColumn_(
  headers,
  aliases,
  countryCode,
  logicalName
) {
  const columnIndex =
    findAmazonInvoiceAggregationColumnOptional_(
      headers,
      aliases
    );

  if (
    columnIndex !== -1
  ) {
    return columnIndex;
  }

  throw new Error(
    "The " +
    countryCode +
    ' sheet does not contain required column "' +
    logicalName +
    '". Expected one of: ' +
    aliases.join(", ") +
    "."
  );
}


function findAmazonInvoiceAggregationColumnOptional_(
  headers,
  aliases
) {
  const normalizedHeaders =
    headers.map(
      function (header) {
        return normalizeAmazonInvoiceAggregationHeader_(
          header
        );
      }
    );

  for (
    let aliasIndex = 0;
    aliasIndex < aliases.length;
    aliasIndex += 1
  ) {
    const normalizedAlias =
      normalizeAmazonInvoiceAggregationHeader_(
        aliases[
          aliasIndex
        ]
      );

    const columnIndex =
      normalizedHeaders.indexOf(
        normalizedAlias
      );

    if (
      columnIndex !== -1
    ) {
      return columnIndex;
    }
  }

  return -1;
}


function normalizeAmazonInvoiceAggregationHeader_(
  value
) {
  return String(
    value === null ||
    typeof value ===
      "undefined"
      ? ""
      : value
  )
    .normalize("NFC")
    .replace(
      /\u00A0/g,
      " "
    )
    .trim()
    .toLocaleLowerCase();
}


function parseAmazonInvoiceAggregationNumber_(
  value,
  countryCode,
  columnName,
  rowNumber
) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  let text =
    String(
      value === null ||
      typeof value ===
        "undefined"
        ? ""
        : value
    )
      .trim()
      .replace(
        /\u00A0/g,
        ""
      )
      .replace(
        /\s+/g,
        ""
      )
      .replace(
        /[−–—]/g,
        "-"
      );

  if (!text) {
    throw new Error(
      "The " +
      countryCode +
      ' sheet contains an empty "' +
      columnName +
      '" value in row ' +
      rowNumber +
      "."
    );
  }

  if (
    /^\(.*\)$/.test(
      text
    )
  ) {
    text =
      "-" +
      text.slice(
        1,
        -1
      );
  }

  text =
    text.replace(
      /[^\d,.\-+]/g,
      ""
    );

  const commaIndex =
    text.lastIndexOf(
      ","
    );

  const dotIndex =
    text.lastIndexOf(
      "."
    );

  if (
    commaIndex !== -1 &&
    dotIndex !== -1
  ) {
    if (
      commaIndex >
      dotIndex
    ) {
      text =
        text
          .replace(
            /\./g,
            ""
          )
          .replace(
            ",",
            "."
          );
    } else {
      text =
        text.replace(
          /,/g,
          ""
        );
    }
  } else if (
    commaIndex !== -1
  ) {
    text =
      text.replace(
        ",",
        "."
      );
  }

  const parsed =
    Number(
      text
    );

  if (
    !Number.isFinite(
      parsed
    )
  ) {
    throw new Error(
      "The " +
      countryCode +
      ' sheet contains an invalid "' +
      columnName +
      '" value in row ' +
      rowNumber +
      ": " +
      value +
      "."
    );
  }

  return parsed;
}


function roundAmazonInvoiceAggregationNumber_(
  value,
  decimals
) {
  const factor =
    Math.pow(
      10,
      decimals
    );

  return (
    Math.round(
      (
        value +
        Number.EPSILON
      ) *
        factor
    ) /
    factor
  );
}






function ensureAmazonInvoiceAggregationSheetSize_(
  sheet,
  requiredRows,
  requiredColumns
) {
  const currentRows =
    sheet.getMaxRows();

  const currentColumns =
    sheet.getMaxColumns();

  if (
    requiredRows >
    currentRows
  ) {
    sheet.insertRowsAfter(
      currentRows,
      requiredRows -
        currentRows
    );
  }

  if (
    requiredColumns >
    currentColumns
  ) {
    sheet.insertColumnsAfter(
      currentColumns,
      requiredColumns -
        currentColumns
    );
  }
}