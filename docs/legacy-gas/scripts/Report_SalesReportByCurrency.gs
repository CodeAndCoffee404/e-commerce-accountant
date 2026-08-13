/**
 * Модуль отчёта Sales report by currency.
 *
 * Разделяет строки Amazon VAT transaction report
 * по уникальным значениям TRANSACTION_CURRENCY_CODE.
 *
 * Для каждой валюты создаётся отдельная Google-таблица.
 */

const SALES_REPORT_BY_CURRENCY_CONFIG = Object.freeze({
  currencyHeader:
    "TRANSACTION_CURRENCY_CODE",

  amountHeader:
    "TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL",

  highlightedColumnWidthPixels: 300,

  amountColumnBackground:
    "#00E5FF",

  currencyColumnBackground:
    "#FF8A65",

  totalCellBackground:
    "#FFF200",

  numberFormat:
    "#,##0.00"
});


/**
 * Генерирует Sales report by currency.
 *
 * @param {{
 *   reportType: string,
 *   period: string,
 *   sourceType: string,
 *   sourceSpreadsheetId: string,
 *   sourceSpreadsheetUrl: string,
 *   destinationFolderId: string
 * }} context
 *
 * @returns {{
 *   createdFiles: number,
 *   processedRows: number,
 *   skippedRows: number
 * }}
 */
function generateSalesReportByCurrency(context) {
  validateSalesReportContext_(context);

  const sourceSpreadsheet =
    openSalesSourceSpreadsheet_(
      context.sourceSpreadsheetId
    );

  const sourceSheets =
    sourceSpreadsheet.getSheets();

  if (sourceSheets.length !== 1) {
    throw new Error(
      "The source Google Sheet must contain exactly one sheet. " +
      "The selected source contains " +
      sourceSheets.length +
      " sheets."
    );
  }

  const sourceSheet = sourceSheets[0];

  const sourceValues = sourceSheet
    .getDataRange()
    .getValues();

  if (sourceValues.length === 0) {
    throw new Error(
      "The source Google Sheet is empty."
    );
  }

  if (sourceValues.length === 1) {
    throw new Error(
      "The source Google Sheet contains headers but no data rows."
    );
  }

  const headers = sourceValues[0];

  const currencyColumnIndex =
    findSalesReportColumn_(
      headers,
      SALES_REPORT_BY_CURRENCY_CONFIG
        .currencyHeader
    );

  const amountColumnIndex =
    findSalesReportColumn_(
      headers,
      SALES_REPORT_BY_CURRENCY_CONFIG
        .amountHeader
    );

  /**
   * Структура:
   *
   * {
   *   EUR: {
   *     rows: [...],
   *     totalAmount: 1234.56
   *   }
   * }
   */
  const dataByCurrency = {};

  let skippedRows = 0;

  for (
    let rowIndex = 1;
    rowIndex < sourceValues.length;
    rowIndex++
  ) {
    const sourceRow =
      sourceValues[rowIndex];

    const currency = String(
      sourceRow[currencyColumnIndex] || ""
    ).trim();

    if (!currency) {
      skippedRows++;
      continue;
    }

    /**
     * Создаём копию, чтобы не изменять
     * исходный массив sourceValues.
     */
    const outputRow =
      sourceRow.slice();

    const numericAmount =
      parseSalesReportAmount_(
        sourceRow[amountColumnIndex],
        rowIndex + 1
      );

    outputRow[amountColumnIndex] =
      numericAmount;

    if (!dataByCurrency[currency]) {
      dataByCurrency[currency] = {
        rows: [],
        totalAmount: 0
      };
    }

    dataByCurrency[currency]
      .rows
      .push(outputRow);

    if (typeof numericAmount === "number") {
      dataByCurrency[currency]
        .totalAmount += numericAmount;
    }
  }

  const currencies =
    Object.keys(dataByCurrency).sort();

  if (currencies.length === 0) {
    throw new Error(
      "The source report contains no rows with a valid " +
      SALES_REPORT_BY_CURRENCY_CONFIG.currencyHeader +
      "."
    );
  }

  const destinationFolder =
    getSalesDestinationFolder_(
      context.destinationFolderId
    );

  let createdFiles = 0;

  currencies.forEach(function (currency) {
    const currencyData =
      dataByCurrency[currency];

    createCurrencySpreadsheet_({
      currency: currency,
      period: context.period,

      headers: headers,
      rows: currencyData.rows,

      totalAmount:
        currencyData.totalAmount,

      amountColumnIndex:
        amountColumnIndex,

      currencyColumnIndex:
        currencyColumnIndex,

      destinationFolder:
        destinationFolder
    });

    createdFiles++;
  });

  return {
    createdFiles: createdFiles,

    processedRows:
      sourceValues.length - 1,

    skippedRows: skippedRows
  };
}


/**
 * Создаёт Google-таблицу для одной валюты.
 *
 * @param {{
 *   currency: string,
 *   period: string,
 *   headers: Array<*>,
 *   rows: Array<Array<*>>,
 *   totalAmount: number,
 *   amountColumnIndex: number,
 *   currencyColumnIndex: number,
 *   destinationFolder:
 *     GoogleAppsScript.Drive.Folder
 * }} options
 */
function createCurrencySpreadsheet_(options) {
  const safeCurrency =
    sanitizeCurrencyName_(
      options.currency
    );

  const spreadsheetName =
    "Sales report by currency - " +
    options.period +
    " - " +
    safeCurrency;

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
      options.destinationFolder
    );

    const sheet =
      spreadsheet.getSheets()[0];

    sheet.setName(
      sanitizeSheetName_(
        safeCurrency
      )
    );

    const outputValues = [
      options.headers
    ].concat(options.rows);

    /**
     * Итоговая строка идёт сразу после данных.
     *
     * Строка 1 — заголовки.
     * Строки 2...N — данные.
     * Следующая строка — сумма.
     */
    const totalRowNumber =
      outputValues.length + 1;

    ensureSalesCurrencySheetSize_(
      sheet,
      totalRowNumber,
      options.headers.length
    );

    /**
     * Записываем заголовки и данные.
     */
    sheet.getRange(
      1,
      1,
      outputValues.length,
      options.headers.length
    ).setValues(outputValues);

    /**
     * Записываем сумму в последнюю строку
     * столбца TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL.
     */
    const totalCell =
      sheet.getRange(
        totalRowNumber,
        options.amountColumnIndex + 1
      );

    totalCell.setValue(
      options.totalAmount
    );

    formatSalesCurrencySpreadsheet_(
      sheet,
      {
        dataRowCount:
          options.rows.length,

        totalRowNumber:
          totalRowNumber,

        amountColumnIndex:
          options.amountColumnIndex,

        currencyColumnIndex:
          options.currencyColumnIndex
      }
    );

    SpreadsheetApp.flush();
  } catch (error) {
    if (spreadsheetFile) {
      try {
        spreadsheetFile.setTrashed(true);
      } catch (cleanupError) {
        console.error(
          "Failed to remove incomplete currency file:",
          cleanupError
        );
      }
    }

    throw new Error(
      'The Google Sheet for currency "' +
      options.currency +
      '" could not be created. ' +
      getSalesErrorMessage_(error)
    );
  }
}


/**
 * Применяет форматирование к валютному отчёту.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {{
 *   dataRowCount: number,
 *   totalRowNumber: number,
 *   amountColumnIndex: number,
 *   currencyColumnIndex: number
 * }} options
 */
function formatSalesCurrencySpreadsheet_(
  sheet,
  options
) {
  const amountColumnNumber =
    options.amountColumnIndex + 1;

  const currencyColumnNumber =
    options.currencyColumnIndex + 1;

  /**
   * Диапазон включает:
   * - заголовок;
   * - все строки данных;
   * - строку суммы.
   */
  const fullFormattedRowCount =
    options.totalRowNumber;

  const amountColumnRange =
    sheet.getRange(
      1,
      amountColumnNumber,
      fullFormattedRowCount,
      1
    );

  const currencyColumnRange =
    sheet.getRange(
      1,
      currencyColumnNumber,
      fullFormattedRowCount,
      1
    );

  /**
   * Разные яркие цвета для двух колонок.
   */
  amountColumnRange.setBackground(
    SALES_REPORT_BY_CURRENCY_CONFIG
      .amountColumnBackground
  );

  currencyColumnRange.setBackground(
    SALES_REPORT_BY_CURRENCY_CONFIG
      .currencyColumnBackground
  );

  /**
   * Фиксированная увеличенная ширина.
   */
  sheet.setColumnWidth(
    amountColumnNumber,
    SALES_REPORT_BY_CURRENCY_CONFIG
      .highlightedColumnWidthPixels
  );

  sheet.setColumnWidth(
    currencyColumnNumber,
    SALES_REPORT_BY_CURRENCY_CONFIG
      .highlightedColumnWidthPixels
  );

  /**
   * Числовой формат для строк данных.
   */
  if (options.dataRowCount > 0) {
    sheet.getRange(
      2,
      amountColumnNumber,
      options.dataRowCount,
      1
    ).setNumberFormat(
      SALES_REPORT_BY_CURRENCY_CONFIG
        .numberFormat
    );
  }

  /**
   * Формат итоговой суммы.
   *
   * Этот фон перезаписывает голубой фон
   * основной колонки только для итоговой ячейки.
   */
  const totalCell =
    sheet.getRange(
      options.totalRowNumber,
      amountColumnNumber
    );

  totalCell
    .setBackground(
      SALES_REPORT_BY_CURRENCY_CONFIG
        .totalCellBackground
    )
    .setFontWeight("bold")
    .setFontSize(24)
    .setNumberFormat(
      SALES_REPORT_BY_CURRENCY_CONFIG
        .numberFormat
    );
}


/**
 * Преобразует значение суммы в число.
 *
 * Поддерживает:
 * - уже готовые числа;
 * - 1234.56;
 * - 1234,56;
 * - 1,234.56;
 * - 1.234,56;
 * - отрицательные значения;
 * - значения в скобках: (123.45).
 *
 * Пустое значение возвращается как пустая строка.
 *
 * @param {*} value
 * @param {number} sourceRowNumber
 *
 * @returns {number|string}
 */
function parseSalesReportAmount_(
  value,
  sourceRowNumber
) {
  if (
    value === "" ||
    value === null ||
    typeof value === "undefined"
  ) {
    return "";
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  let text = String(value)
    .replace(/\u00A0/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (!text) {
    return "";
  }

  let isNegative = false;

  if (
    text.startsWith("(") &&
    text.endsWith(")")
  ) {
    isNegative = true;

    text = text.substring(
      1,
      text.length - 1
    );
  }

  /**
   * Оставляем только цифры, знаки,
   * точку и запятую.
   */
  text = text.replace(
    /[^0-9,.\-+]/g,
    ""
  );

  const lastCommaIndex =
    text.lastIndexOf(",");

  const lastDotIndex =
    text.lastIndexOf(".");

  /**
   * Если присутствуют и точка, и запятая,
   * последний разделитель считаем десятичным.
   */
  if (
    lastCommaIndex !== -1 &&
    lastDotIndex !== -1
  ) {
    if (lastCommaIndex > lastDotIndex) {
      /**
       * Формат 1.234,56
       */
      text = text
        .replace(/\./g, "")
        .replace(",", ".");
    } else {
      /**
       * Формат 1,234.56
       */
      text = text.replace(/,/g, "");
    }
  } else if (lastCommaIndex !== -1) {
    /**
     * Формат 1234,56.
     */
    text = text.replace(",", ".");
  }

  const numericValue =
    Number(text);

  if (!Number.isFinite(numericValue)) {
    throw new Error(
      'The value "' +
      value +
      '" in column "' +
      SALES_REPORT_BY_CURRENCY_CONFIG.amountHeader +
      '" could not be converted to a number. ' +
      "Source row: " +
      sourceRowNumber +
      "."
    );
  }

  return isNegative
    ? -Math.abs(numericValue)
    : numericValue;
}


/**
 * Проверяет и при необходимости увеличивает лист.
 *
 * Название функции специально уникальное,
 * чтобы не конфликтовать с ensureSheetSize_
 * из UploadService.gs.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} requiredRows
 * @param {number} requiredColumns
 */
function ensureSalesCurrencySheetSize_(
  sheet,
  requiredRows,
  requiredColumns
) {
  const currentRows =
    sheet.getMaxRows();

  const currentColumns =
    sheet.getMaxColumns();

  if (requiredRows > currentRows) {
    sheet.insertRowsAfter(
      currentRows,
      requiredRows - currentRows
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
 * Проверяет обязательные параметры модуля.
 *
 * @param {Object} context
 */
function validateSalesReportContext_(context) {
  if (
    !context ||
    typeof context !== "object"
  ) {
    throw new Error(
      "The Sales report by currency context is missing."
    );
  }

  const requiredFields = [
    "period",
    "sourceSpreadsheetId",
    "destinationFolderId"
  ];

  requiredFields.forEach(function (field) {
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
  });
}


/**
 * Открывает исходную таблицу.
 *
 * @param {string} spreadsheetId
 *
 * @returns {
 *   GoogleAppsScript.Spreadsheet.Spreadsheet
 * }
 */
function openSalesSourceSpreadsheet_(
  spreadsheetId
) {
  try {
    return SpreadsheetApp.openById(
      spreadsheetId
    );
  } catch (error) {
    throw new Error(
      "The source Google Sheet could not be opened. " +
      "Check that it exists and that you have access to it."
    );
  }
}


/**
 * Получает папку создаваемого отчёта.
 *
 * @param {string} folderId
 *
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function getSalesDestinationFolder_(
  folderId
) {
  try {
    return DriveApp.getFolderById(
      folderId
    );
  } catch (error) {
    throw new Error(
      "The report destination folder could not be opened."
    );
  }
}


/**
 * Ищет колонку по точному
 * нормализованному названию.
 *
 * @param {Array<*>} headers
 * @param {string} requiredHeader
 *
 * @returns {number}
 */
function findSalesReportColumn_(
  headers,
  requiredHeader
) {
  const normalizedRequired =
    normalizeSalesHeader_(
      requiredHeader
    );

  const columnIndex =
    headers.findIndex(
      function (header) {
        return (
          normalizeSalesHeader_(
            header
          ) ===
          normalizedRequired
        );
      }
    );

  if (columnIndex === -1) {
    throw new Error(
      'The required column "' +
      requiredHeader +
      '" was not found in the source report.'
    );
  }

  return columnIndex;
}


/**
 * Нормализует заголовок исходного отчёта.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeSalesHeader_(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .trim()
    .toUpperCase();
}


/**
 * Подготавливает валюту
 * для названия файла.
 *
 * @param {string} currency
 * @returns {string}
 */
function sanitizeCurrencyName_(currency) {
  const sanitized =
    String(currency || "")
      .trim()
      .replace(
        /[\\/:*?"<>|#%{}~]/g,
        "-"
      )
      .replace(/\s+/g, " ")
      .substring(0, 80)
      .trim();

  return sanitized || "UNKNOWN";
}


/**
 * Подготавливает название листа.
 *
 * Google Sheets запрещает символы:
 * : \ / ? * [ ]
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizeSheetName_(name) {
  const sanitized =
    String(name || "")
      .replace(
        /[:\\/?*\[\]]/g,
        "-"
      )
      .substring(0, 100)
      .trim();

  return sanitized || "Data";
}


/**
 * Возвращает безопасный текст
 * внутренней ошибки.
 *
 * @param {*} error
 * @returns {string}
 */
function getSalesErrorMessage_(error) {
  if (
    error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }

  return "An unexpected error occurred.";
}