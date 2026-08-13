/**
 * Code.gs
 *
 * Общая инфраструктура генератора отчётов.
 *
 * Каждый тип создаваемого отчёта находится
 * в отдельном .gs-файле и предоставляет
 * собственную функцию-генератор.
 */

const REPORT_GENERATOR_CONFIG = Object.freeze({
  DATABASE_SPREADSHEET_ID:
    "1BUEIzz0PTPhm1HMKqMAf-I1hItL2ToH-5Qr0HVisGYU",

  RAW_REPORT_DATABASE_SHEET:
    "Raw report database",

  REPORT_LOG_SHEET:
    "Report log",

  DESTINATION_FOLDER_ID:
    "1tMBitNk5fqaXr3qqOuUb-cjYc3AyMIlL",

  TIME_ZONE:
    "Europe/Amsterdam",

  DATE_TIME_FORMAT:
    "yyyy-MM-dd HH-mm-ss",

  LOCK_TIMEOUT_MS:
    30000
});

const REPORT_GENERATOR_TYPES = Object.freeze({
  "sales-report-by-currency": Object.freeze({
    value:
      "sales-report-by-currency",

    label:
      "Sales report by currency",

    sourceType:
      "Amazon VAT transaction report",

    generator:
      generateSalesReportByCurrency
  }),

  "off-amazon-sales": Object.freeze({
    value:
      "off-amazon-sales",

    label:
      "Off-Amazon Sales",

    sourceTypes: Object.freeze([
      "Allegro sales report",
      "Cdiscount sales report",
      "Geyser shopify sales report"
    ]),

    generator:
      generateOffAmazonSales
  }),

  "amazon-invoice-for-zoho": Object.freeze({
    value:
      "amazon-invoice-for-zoho",

    label:
      "Amazon invoice for Zoho",

    monthlyCountrySourceTypes: Object.freeze({
      ES: "Amazon Monthly Transaction report ES",
      IT: "Amazon Monthly Transaction report IT",
      FR: "Amazon Monthly Transaction report FR",
      DE: "Amazon Monthly Transaction report DE",
      UK: "Amazon Monthly Transaction report UK",
      SE: "Amazon Monthly Transaction report SE",
      PL: "Amazon Monthly Transaction report PL",
      NL: "Amazon Monthly Transaction report NL",
      IE: "Amazon Monthly Transaction report IE",
      BE: "Amazon Monthly Transaction report BE"
    }),

    generator:
      generateAmazonInvoiceForZoho
  })
});

function getReportGeneratorOptions() {
  try {
    const reportTypes =
      Object.keys(
        REPORT_GENERATOR_TYPES
      ).map(function (key) {
        const config =
          REPORT_GENERATOR_TYPES[key];

        return {
          value: config.value,
          label: config.label
        };
      });

    return {
      success: true,
      reportTypes: reportTypes,
      periods:
        getAvailableReportPeriods_()
    };
  } catch (error) {
    throw new Error(
      getReadableErrorMessage_(
        error,
        "The report generator options could not be loaded."
      )
    );
  }
}

function generateSelectedReport(request) {
  const lock =
    LockService.getScriptLock();

  let lockAcquired = false;
  let reportFolder = null;

  try {
    lockAcquired = lock.tryLock(
      REPORT_GENERATOR_CONFIG
        .LOCK_TIMEOUT_MS
    );

    if (!lockAcquired) {
      throw new Error(
        "Another report is currently being generated. " +
        "Please try again after it has finished."
      );
    }

    validateGenerateReportRequest_(
      request
    );

    const reportTypeKey =
      String(
        request.reportType
      ).trim();

    const period =
      String(
        request.period
      ).trim();

    const reportConfig =
      REPORT_GENERATOR_TYPES[
        reportTypeKey
      ];

    const sourceReports =
      resolveReportSources_(
        reportConfig,
        period
      );

    const parentFolder =
      getDestinationFolder_();

    reportFolder =
      createReportFolder_(
        parentFolder,
        reportConfig.label,
        period
      );

    if (
      typeof reportConfig.generator !==
      "function"
    ) {
      throw new Error(
        'The generator for "' +
        reportConfig.label +
        '" is not available.'
      );
    }

    const generatorContext =
      createGeneratorContext_(
        reportConfig,
        period,
        sourceReports,
        reportFolder
      );

    const generationResult =
      reportConfig.generator(
        generatorContext
      );

    validateGenerationResult_(
      generationResult
    );

    appendReportLogEntry_({
      reportType:
        reportConfig.label,

      period: period,

      folderName:
        reportFolder.getName(),

      folderUrl:
        reportFolder.getUrl()
    });

    return {
      success: true,

      reportType:
        reportConfig.label,

      period: period,

      folderName:
        reportFolder.getName(),

      folderUrl:
        reportFolder.getUrl(),

      createdFiles:
        generationResult
          .createdFiles,

      processedRows:
        generationResult
          .processedRows,

      skippedRows:
        generationResult
          .skippedRows
    };
  } catch (error) {
    if (reportFolder) {
      try {
        deleteReportFolder_(
          reportFolder
        );
      } catch (cleanupError) {
        console.error(
          "Failed to remove incomplete report folder:",
          cleanupError
        );
      }
    }

    throw new Error(
      getReadableErrorMessage_(
        error,
        "The report could not be generated."
      )
    );
  } finally {
    if (lockAcquired) {
      try {
        lock.releaseLock();
      } catch (lockError) {
        console.error(
          "Failed to release report generator lock:",
          lockError
        );
      }
    }
  }
}

function createGeneratorContext_(
  reportConfig,
  period,
  sourceReports,
  reportFolder
) {
  const context = {
    reportType:
      reportConfig.label,

    period: period,

    sourceReports:
      sourceReports,

    destinationFolderId:
      reportFolder.getId()
  };

  if (reportConfig.sourceType) {
    const source =
      sourceReports[
        reportConfig.sourceType
      ];

    context.sourceType =
      reportConfig.sourceType;

    context.sourceSpreadsheetId =
      source.sourceSpreadsheetId;

    context.sourceSpreadsheetUrl =
      source.sourceSpreadsheetUrl;
  }

  return context;
}

function validateGenerateReportRequest_(
  request
) {
  if (
    !request ||
    typeof request !== "object"
  ) {
    throw new Error(
      "The report request is missing or invalid."
    );
  }

  const reportType =
    String(
      request.reportType || ""
    ).trim();

  const period =
    String(
      request.period || ""
    ).trim();

  if (!reportType) {
    throw new Error(
      "Please select a report type."
    );
  }

  if (
    !REPORT_GENERATOR_TYPES[
      reportType
    ]
  ) {
    throw new Error(
      "The selected report type is not supported."
    );
  }

  if (!period) {
    throw new Error(
      "Please select a period."
    );
  }
}

function resolveReportSources_(
  reportConfig,
  period
) {
  if (
    reportConfig.monthlyCountrySourceTypes &&
    typeof reportConfig.monthlyCountrySourceTypes === "object"
  ) {
    validateMonthlyReportPeriod_(
      period,
      reportConfig.label
    );

    return findMonthlyCountrySourceReports_(
      reportConfig.monthlyCountrySourceTypes,
      period,
      reportConfig.label
    );
  }

  if (
    Array.isArray(
      reportConfig.sourceTypes
    )
  ) {
    return findMultipleSourceReports_(
      reportConfig.sourceTypes,
      period,
      reportConfig.label
    );
  }

  if (reportConfig.sourceType) {
    const source =
      findSourceReport_(
        reportConfig.sourceType,
        period
      );

    const result = {};

    result[
      reportConfig.sourceType
    ] = source;

    return result;
  }

  throw new Error(
    'No source report configuration is defined for "' +
    reportConfig.label +
    '".'
  );
}

/**
 * Проверяет, что выбран именно месячный период вида:
 * 2026.07 July
 *
 * Amazon invoice for Zoho не создаётся за квартал.
 */
function validateMonthlyReportPeriod_(
  period,
  reportLabel
) {
  const value = String(period || "").trim();

  if (
    !/^\d{4}\.(0[1-9]|1[0-2])\s+[A-Za-z]+$/.test(value)
  ) {
    throw new Error(
      reportLabel +
      ' can be generated only for a monthly period. Selected period: "' +
      value +
      '".'
    );
  }
}


/**
 * Проверяет наличие Amazon Monthly Transaction report
 * по всем обязательным странам за выбранный месяц.
 *
 * Amazon Monthly Transaction report сохраняет все версии,
 * поэтому при нескольких строках Type + Period берётся
 * самая новая запись в Raw report database.
 */
function findMonthlyCountrySourceReports_(
  countrySourceTypes,
  period,
  reportLabel
) {
  const result = {};
  const missingCountries = [];

  Object.keys(countrySourceTypes).forEach(
    function (countryCode) {
      const sourceType =
        countrySourceTypes[countryCode];

      const source =
        findLatestSourceReport_(
          sourceType,
          period
        );

      if (!source) {
        missingCountries.push(
          countryCode
        );
        return;
      }

      result[countryCode] = Object.assign(
        {
          countryCode: countryCode,
          sourceType: sourceType
        },
        source
      );
    }
  );

  if (missingCountries.length > 0) {
    throw new Error(
      reportLabel +
      ' cannot be generated for period "' +
      period +
      '".\n\n' +
      "Missing countries:\n- " +
      missingCountries.join("\n- ")
    );
  }

  return result;
}


/**
 * Возвращает последнюю запись Type + Period из
 * Raw report database. Если записи нет, возвращает null.
 *
 * Это отдельная функция, потому что обычный
 * findSourceReport_ намеренно считает дубликаты ошибкой,
 * а Amazon Monthly Transaction report сохраняет все версии.
 */
function findLatestSourceReport_(
  sourceType,
  period
) {
  const spreadsheet =
    openDatabaseSpreadsheet_();

  const sheet =
    spreadsheet.getSheetByName(
      REPORT_GENERATOR_CONFIG
        .RAW_REPORT_DATABASE_SHEET
    );

  if (!sheet) {
    throw new Error(
      'The sheet "' +
      REPORT_GENERATOR_CONFIG
        .RAW_REPORT_DATABASE_SHEET +
      '" was not found.'
    );
  }

  const dataRange =
    sheet.getDataRange();

  const displayValues =
    dataRange.getDisplayValues();

  const richTextValues =
    dataRange.getRichTextValues();

  if (displayValues.length < 2) {
    return null;
  }

  const headers =
    displayValues[0];

  const typeColumn =
    findRequiredColumn_(
      headers,
      "Type",
      REPORT_GENERATOR_CONFIG
        .RAW_REPORT_DATABASE_SHEET
    );

  const periodColumn =
    findRequiredColumn_(
      headers,
      "Period",
      REPORT_GENERATOR_CONFIG
        .RAW_REPORT_DATABASE_SHEET
    );

  const googleSheetColumn =
    findRequiredColumn_(
      headers,
      "Google sheet",
      REPORT_GENERATOR_CONFIG
        .RAW_REPORT_DATABASE_SHEET
    );

  let matchedRowIndex = -1;

  for (
    let rowIndex =
      displayValues.length - 1;
    rowIndex >= 1;
    rowIndex -= 1
  ) {
    const rowType = String(
      displayValues[rowIndex][typeColumn] || ""
    ).trim();

    const rowPeriod = String(
      displayValues[rowIndex][periodColumn] || ""
    ).trim();

    if (
      rowType === sourceType &&
      rowPeriod === period
    ) {
      matchedRowIndex = rowIndex;
      break;
    }
  }

  if (matchedRowIndex === -1) {
    return null;
  }

  const richTextCell =
    richTextValues[matchedRowIndex][
      googleSheetColumn
    ];

  let sourceSpreadsheetUrl = "";

  if (richTextCell) {
    sourceSpreadsheetUrl =
      richTextCell.getLinkUrl() || "";
  }

  if (
    !sourceSpreadsheetUrl &&
    richTextCell
  ) {
    const runs =
      richTextCell.getRuns();

    for (
      let index = 0;
      index < runs.length;
      index += 1
    ) {
      const runUrl =
        runs[index].getLinkUrl();

      if (runUrl) {
        sourceSpreadsheetUrl =
          runUrl;
        break;
      }
    }
  }

  if (!sourceSpreadsheetUrl) {
    sourceSpreadsheetUrl = String(
      displayValues[matchedRowIndex][
        googleSheetColumn
      ] || ""
    ).trim();
  }

  if (!sourceSpreadsheetUrl) {
    throw new Error(
      'The "Google sheet" link is missing for "' +
      sourceType +
      '" and period "' +
      period +
      '".'
    );
  }

  const sourceSpreadsheetId =
    extractGoogleSpreadsheetId_(
      sourceSpreadsheetUrl
    );

  if (!sourceSpreadsheetId) {
    throw new Error(
      'The "Google sheet" link for "' +
      sourceType +
      '" and period "' +
      period +
      '" is not a valid Google Sheets link.'
    );
  }

  try {
    SpreadsheetApp.openById(
      sourceSpreadsheetId
    );
  } catch (error) {
    throw new Error(
      'The source Google Sheet for "' +
      sourceType +
      '" and period "' +
      period +
      '" could not be opened. Check that the file ' +
      "still exists and that you have access to it."
    );
  }

  return {
    sourceSpreadsheetId:
      sourceSpreadsheetId,

    sourceSpreadsheetUrl:
      sourceSpreadsheetUrl
  };
}


function findMultipleSourceReports_(
  sourceTypes,
  period,
  reportLabel
) {
  const result = {};
  const missingReports = [];

  sourceTypes.forEach(
    function (sourceType) {
      try {
        result[sourceType] =
          findSourceReport_(
            sourceType,
            period
          );
      } catch (error) {
        const message =
          getReadableErrorMessage_(
            error,
            ""
          );

        const missingPrefix =
          'No "' +
          sourceType +
          '" source report was found for period "' +
          period +
          '".';

        if (
          message.indexOf(
            missingPrefix
          ) === 0
        ) {
          missingReports.push(
            sourceType
          );

          return;
        }

        throw error;
      }
    }
  );

  if (missingReports.length > 0) {
    throw new Error(
      reportLabel +
      ' cannot be generated for period "' +
      period +
      '".\n\n' +
      "Missing raw reports:\n- " +
      missingReports.join("\n- ")
    );
  }

  return result;
}

function getAvailableReportPeriods_() {
  const spreadsheet =
    openDatabaseSpreadsheet_();

  const sheet =
    spreadsheet.getSheetByName(
      REPORT_GENERATOR_CONFIG
        .RAW_REPORT_DATABASE_SHEET
    );

  if (!sheet) {
    throw new Error(
      'The sheet "' +
      REPORT_GENERATOR_CONFIG
        .RAW_REPORT_DATABASE_SHEET +
      '" was not found.'
    );
  }

  const values =
    sheet
      .getDataRange()
      .getDisplayValues();

  if (values.length < 2) {
    return [];
  }

  const headers = values[0];

  const periodColumn =
    findRequiredColumn_(
      headers,
      "Period",
      REPORT_GENERATOR_CONFIG
        .RAW_REPORT_DATABASE_SHEET
    );

  const uniquePeriods =
    new Set();

  for (
    let rowIndex = 1;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const period =
      String(
        values[rowIndex][
          periodColumn
        ] || ""
      ).trim();

    if (period) {
      uniquePeriods.add(
        period
      );
    }
  }

  return Array.from(
    uniquePeriods
  );
}

function findSourceReport_(
  sourceType,
  period
) {
  const spreadsheet =
    openDatabaseSpreadsheet_();

  const sheet =
    spreadsheet.getSheetByName(
      REPORT_GENERATOR_CONFIG
        .RAW_REPORT_DATABASE_SHEET
    );

  if (!sheet) {
    throw new Error(
      'The sheet "' +
      REPORT_GENERATOR_CONFIG
        .RAW_REPORT_DATABASE_SHEET +
      '" was not found.'
    );
  }

  const dataRange =
    sheet.getDataRange();

  const displayValues =
    dataRange.getDisplayValues();

  const richTextValues =
    dataRange.getRichTextValues();

  if (displayValues.length < 2) {
    throw new Error(
      "Raw report database contains no report records."
    );
  }

  const headers =
    displayValues[0];

  const typeColumn =
    findRequiredColumn_(
      headers,
      "Type",
      REPORT_GENERATOR_CONFIG
        .RAW_REPORT_DATABASE_SHEET
    );

  const periodColumn =
    findRequiredColumn_(
      headers,
      "Period",
      REPORT_GENERATOR_CONFIG
        .RAW_REPORT_DATABASE_SHEET
    );

  const googleSheetColumn =
    findRequiredColumn_(
      headers,
      "Google sheet",
      REPORT_GENERATOR_CONFIG
        .RAW_REPORT_DATABASE_SHEET
    );

  const matchingRows = [];

  for (
    let rowIndex = 1;
    rowIndex < displayValues.length;
    rowIndex += 1
  ) {
    const rowType =
      String(
        displayValues[rowIndex][
          typeColumn
        ] || ""
      ).trim();

    const rowPeriod =
      String(
        displayValues[rowIndex][
          periodColumn
        ] || ""
      ).trim();

    if (
      rowType === sourceType &&
      rowPeriod === period
    ) {
      matchingRows.push(
        rowIndex
      );
    }
  }

  if (matchingRows.length === 0) {
    throw new Error(
      'No "' +
      sourceType +
      '" source report was found for period "' +
      period +
      '". Please check the Raw report database.'
    );
  }

  if (matchingRows.length > 1) {
    throw new Error(
      'More than one "' +
      sourceType +
      '" source report was found for period "' +
      period +
      '". Please remove the duplicate records from ' +
      "the Raw report database."
    );
  }

  const matchedRowIndex =
    matchingRows[0];

  const richTextCell =
    richTextValues[
      matchedRowIndex
    ][googleSheetColumn];

  let sourceSpreadsheetUrl = "";

  if (richTextCell) {
    sourceSpreadsheetUrl =
      richTextCell.getLinkUrl() ||
      "";
  }

  if (
    !sourceSpreadsheetUrl &&
    richTextCell
  ) {
    const runs =
      richTextCell.getRuns();

    for (
      let index = 0;
      index < runs.length;
      index += 1
    ) {
      const runUrl =
        runs[index].getLinkUrl();

      if (runUrl) {
        sourceSpreadsheetUrl =
          runUrl;

        break;
      }
    }
  }

  if (!sourceSpreadsheetUrl) {
    sourceSpreadsheetUrl =
      String(
        displayValues[
          matchedRowIndex
        ][googleSheetColumn] || ""
      ).trim();
  }

  if (!sourceSpreadsheetUrl) {
    throw new Error(
      'The "Google sheet" link is missing for "' +
      sourceType +
      '" and period "' +
      period +
      '".'
    );
  }

  const sourceSpreadsheetId =
    extractGoogleSpreadsheetId_(
      sourceSpreadsheetUrl
    );

  if (!sourceSpreadsheetId) {
    throw new Error(
      'The "Google sheet" link for "' +
      sourceType +
      '" and period "' +
      period +
      '" is not a valid Google Sheets link.'
    );
  }

  try {
    SpreadsheetApp.openById(
      sourceSpreadsheetId
    );
  } catch (error) {
    throw new Error(
      'The source Google Sheet for "' +
      sourceType +
      '" and period "' +
      period +
      '" could not be opened. Check that the file ' +
      "still exists and that you have access to it."
    );
  }

  return {
    sourceSpreadsheetId:
      sourceSpreadsheetId,

    sourceSpreadsheetUrl:
      sourceSpreadsheetUrl
  };
}

function createReportFolder_(
  parentFolder,
  reportTypeLabel,
  period
) {
  const baseFolderName =
    reportTypeLabel +
    " - " +
    period;

  let folderName =
    baseFolderName;

  if (
    parentFolder
      .getFoldersByName(
        baseFolderName
      )
      .hasNext()
  ) {
    const timestamp =
      Utilities.formatDate(
        new Date(),
        REPORT_GENERATOR_CONFIG
          .TIME_ZONE,
        REPORT_GENERATOR_CONFIG
          .DATE_TIME_FORMAT
      );

    folderName =
      baseFolderName +
      " - " +
      timestamp;

    let suffix = 2;

    while (
      parentFolder
        .getFoldersByName(
          folderName
        )
        .hasNext()
    ) {
      folderName =
        baseFolderName +
        " - " +
        timestamp +
        " (" +
        suffix +
        ")";

      suffix += 1;
    }
  }

  try {
    return parentFolder
      .createFolder(
        folderName
      );
  } catch (error) {
    throw new Error(
      'The report folder "' +
      folderName +
      '" could not be created. Check that you have ' +
      "permission to create files in the destination folder."
    );
  }
}

function appendReportLogEntry_(
  entry
) {
  const spreadsheet =
    openDatabaseSpreadsheet_();

  const sheet =
    spreadsheet.getSheetByName(
      REPORT_GENERATOR_CONFIG
        .REPORT_LOG_SHEET
    );

  if (!sheet) {
    throw new Error(
      'The sheet "' +
      REPORT_GENERATOR_CONFIG
        .REPORT_LOG_SHEET +
      '" was not found.'
    );
  }

  const lastColumn =
    Math.max(
      sheet.getLastColumn(),
      1
    );

  const headers =
    sheet
      .getRange(
        1,
        1,
        1,
        lastColumn
      )
      .getDisplayValues()[0];

  const reportTypeColumn =
    findRequiredColumn_(
      headers,
      "Report type",
      REPORT_GENERATOR_CONFIG
        .REPORT_LOG_SHEET
    );

  const periodColumn =
    findRequiredColumn_(
      headers,
      "Period",
      REPORT_GENERATOR_CONFIG
        .REPORT_LOG_SHEET
    );

  const linkColumn =
    findRequiredColumn_(
      headers,
      "Link",
      REPORT_GENERATOR_CONFIG
        .REPORT_LOG_SHEET
    );

  const targetRow =
    Math.max(
      sheet.getLastRow() + 1,
      2
    );

  const rowValues =
    new Array(
      lastColumn
    ).fill("");

  rowValues[
    reportTypeColumn
  ] = entry.reportType;

  rowValues[
    periodColumn
  ] = entry.period;

  rowValues[
    linkColumn
  ] = entry.folderName;

  sheet.getRange(
    targetRow,
    1,
    1,
    lastColumn
  ).setValues([
    rowValues
  ]);

  const richTextLink =
    SpreadsheetApp
      .newRichTextValue()
      .setText(
        entry.folderName
      )
      .setLinkUrl(
        entry.folderUrl
      )
      .build();

  sheet.getRange(
    targetRow,
    linkColumn + 1
  ).setRichTextValue(
    richTextLink
  );
}

function deleteReportFolder_(
  folder
) {
  const childFolders =
    folder.getFolders();

  while (
    childFolders.hasNext()
  ) {
    deleteReportFolder_(
      childFolders.next()
    );
  }

  const childFiles =
    folder.getFiles();

  while (
    childFiles.hasNext()
  ) {
    childFiles
      .next()
      .setTrashed(true);
  }

  folder.setTrashed(true);
}

function validateGenerationResult_(
  result
) {
  if (
    !result ||
    typeof result !== "object"
  ) {
    throw new Error(
      "The report module returned an invalid result."
    );
  }

  const requiredFields = [
    "createdFiles",
    "processedRows",
    "skippedRows"
  ];

  requiredFields.forEach(
    function (field) {
      if (
        typeof result[field] !==
          "number" ||
        !Number.isFinite(
          result[field]
        ) ||
        result[field] < 0
      ) {
        throw new Error(
          'The report module returned an invalid "' +
          field +
          '" value.'
        );
      }
    }
  );
}

function openDatabaseSpreadsheet_() {
  try {
    return SpreadsheetApp.openById(
      REPORT_GENERATOR_CONFIG
        .DATABASE_SPREADSHEET_ID
    );
  } catch (error) {
    throw new Error(
      "The report database could not be opened. " +
      "Check that you have access to it."
    );
  }
}

function getDestinationFolder_() {
  try {
    return DriveApp.getFolderById(
      REPORT_GENERATOR_CONFIG
        .DESTINATION_FOLDER_ID
    );
  } catch (error) {
    throw new Error(
      "The destination folder could not be opened. " +
      "Check that it exists and that you have access to it."
    );
  }
}

function findRequiredColumn_(
  headers,
  requiredHeader,
  sheetName
) {
  const normalizedRequired =
    normalizeGeneratorHeader_(
      requiredHeader
    );

  const columnIndex =
    headers.findIndex(
      function (header) {
        return (
          normalizeGeneratorHeader_(
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
      '" was not found in the "' +
      sheetName +
      '" sheet.'
    );
  }

  return columnIndex;
}

function normalizeGeneratorHeader_(
  value
) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase();
}

function extractGoogleSpreadsheetId_(
  url
) {
  const value =
    String(
      url || ""
    ).trim();

  const urlMatch =
    value.match(
      /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/
    );

  if (urlMatch) {
    return urlMatch[1];
  }

  const idOnlyMatch =
    value.match(
      /^[a-zA-Z0-9_-]{20,}$/
    );

  return idOnlyMatch
    ? idOnlyMatch[0]
    : "";
}

function getReadableErrorMessage_(
  error,
  fallbackMessage
) {
  if (
    error &&
    typeof error.message ===
      "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }

  if (
    typeof error === "string" &&
    error.trim()
  ) {
    return error.trim();
  }

  return fallbackMessage;
}