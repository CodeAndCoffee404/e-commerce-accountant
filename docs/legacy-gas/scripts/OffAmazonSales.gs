/**
 * OffAmazonSales.gs
 *
 * Создаёт отчёт Off-Amazon Sales на основании:
 * - Allegro sales report;
 * - Cdiscount sales report;
 * - Geyser shopify sales report.
 *
 * В текущей версии реализовано преобразование:
 * - Allegro;
 * - Cdiscount;
 * - Shopify.
 */

const OFF_AMAZON_SALES_CONFIG = Object.freeze({
  reportName: "Off-Amazon Sales",
  outputSheetName: "off-amazon sales",

  outputHeaders: Object.freeze([
    "Sales channel",
    "transaction date",
    "transaction type",
    "currency",
    "VAT rate",
    "VAT amount",
    "Net amount",
    "Total",
    "departure country",
    "arrival country",
    "seller VAT number",
    "buyer VAT number",
    "TAX_REPORTING_SCHEME"
  ]),

  outputFormats: Object.freeze({
    transactionDate: "yyyy-MM-dd",
    vatRate: "0.00%",
    amount: "0.00"
  }),

  missingVatRateBackground: "#fff2cc",
  departureCountry: "ES",
  regularScheme: "REGULAR",
  unionOssScheme: "UNION-OSS",
  shopifyChannelName: "Shopify",
  shopifyCurrency: "EUR",
  shopifyTransactionType: "B2C SALE",

  allegroChannelName: "Allegro",
  allegroDepartureCountry: "PL",
  allegroSaleTransactionType: "B2C SALE",
  allegroRefundTransactionType: "REFUND",

  allegroCurrencyRules: Object.freeze({
    PLN: Object.freeze({
      currency: "PLN",
      arrivalCountry: "PL",
      vatRate: 0.23,
      sellerVatNumber: "PL5263307678",
      taxReportingScheme: "REGULAR"
    }),

    CZK: Object.freeze({
      currency: "CZK",
      arrivalCountry: "CZ",
      vatRate: 0.21,
      sellerVatNumber: "EE102013089",
      taxReportingScheme: "UNION-OSS"
    }),

    EUR: Object.freeze({
      currency: "EUR",
      arrivalCountry: "SK",
      vatRate: 0.20,
      sellerVatNumber: "EE102013089",
      taxReportingScheme: "UNION-OSS"
    }),

    HUF: Object.freeze({
      currency: "HUF",
      arrivalCountry: "HU",
      vatRate: 0.27,
      sellerVatNumber: "EE102013089",
      taxReportingScheme: "UNION-OSS"
    })
  }),

  cdiscountChannelName: "Cdiscount",
  cdiscountCurrency: "EUR",
  cdiscountTransactionType: "B2C SALE",
  cdiscountVatRate: 0.20,
  cdiscountDepartureCountry: "FR",
  cdiscountArrivalCountry: "FR",
  cdiscountSellerVatNumber: "FR23888800463",
  cdiscountTaxReportingScheme: "REGULAR",

  sellerVatNumbers: Object.freeze({
    EE: "EE102013089",
    ES: "ESN0531416F",
    DE: "DE329037549",
    CZ: "CZ685219093",
    PL: "PL5263307678",
    FR: "FR23888800463",
    IT: "IT00260459995"
  }),

  ossVatNumber: "EE102013089",

  sources: Object.freeze({
    allegro: Object.freeze({
      type: "Allegro sales report",
      sheetName: "Allegro",
      headerRowIndex: 0,
      filterColumn: "kupujący",
      excludedOutputColumns: Object.freeze([]),
      requiredColumns: Object.freeze([
        "data",
        "identyfikator",
        "operacja",
        "kupujący",
        "kwota"
      ])
    }),

    
    cdiscount: Object.freeze({
      type: "Cdiscount sales report",
      sheetName: "Cdiscount",
      headerRowIndex: 2,
      filterColumn: "Invoice type",
      allowedValues: Object.freeze([
        "Remboursement client",
        "Vente"
      ]),
      excludedOutputColumns: Object.freeze([]),
      requiredColumns: Object.freeze([
        "Invoice/Refund Id",
        "Invoice type",
        "Accounting date",
        "Gross amount"
      ])
    }),

    shopify: Object.freeze({
      type: "Geyser shopify sales report",
      sheetName: "Shopify",
      headerRowIndex: 0,
      filterColumn: "Source",
      excludedValue: "shopify_draft_order",
      excludedOutputColumns: Object.freeze([
        "Note Attributes"
      ]),
      requiredColumns: Object.freeze([
        "Name",
        "Created at",
        "Taxes",
        "Total",
        "Shipping Country",
        "Billing Country",
        "Tax 1 Name",
        "Source"
      ])
    })
  })
});


/**
 * Главная функция генератора.
 *
 * @param {{
 *   reportType: string,
 *   period: string,
 *   sourceReports: Object,
 *   destinationFolderId: string
 * }} context
 *
 * @return {{
 *   createdFiles: number,
 *   processedRows: number,
 *   skippedRows: number
 * }}
 */
function generateOffAmazonSales(context) {
  validateOffAmazonContext_(context);

  const sourceResults = prepareOffAmazonSources_(
    context.sourceReports
  );

  const destinationFolder = getOffAmazonDestinationFolder_(
    context.destinationFolderId
  );

  const spreadsheetName =
    OFF_AMAZON_SALES_CONFIG.reportName +
    " - " +
    context.period;

  let outputSpreadsheet = null;
  let outputFile = null;

  try {
    outputSpreadsheet = SpreadsheetApp.create(
      spreadsheetName
    );

    outputFile = DriveApp.getFileById(
      outputSpreadsheet.getId()
    );

    outputFile.moveTo(destinationFolder);

    const buildResult = buildOffAmazonWorkbook_(
      outputSpreadsheet,
      sourceResults
    );

    SpreadsheetApp.flush();

    const sourceFilteredRows = sourceResults.reduce(
      function (total, source) {
        return total + source.filteredRows.length;
      },
      0
    );

    const sourceSkippedRows = sourceResults.reduce(
      function (total, source) {
        return total + source.skippedRows;
      },
      0
    );

    return {
      createdFiles: 1,
      processedRows: sourceFilteredRows,
      skippedRows:
        sourceSkippedRows +
        buildResult.allegroSkippedRows +
        buildResult.cdiscountSkippedRows +
        buildResult.shopifySkippedRows
    };
  } catch (error) {
    if (outputFile) {
      try {
        outputFile.setTrashed(true);
      } catch (cleanupError) {
        console.error(
          "Failed to remove incomplete Off-Amazon Sales file:",
          cleanupError
        );
      }
    }

    throw new Error(
      "The Off-Amazon Sales file could not be created. " +
      getOffAmazonErrorMessage_(error)
    );
  }
}


function validateOffAmazonContext_(context) {
  if (!context || typeof context !== "object") {
    throw new Error(
      "The Off-Amazon Sales context is missing."
    );
  }

  ["period", "destinationFolderId"].forEach(
    function (field) {
      if (!String(context[field] || "").trim()) {
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
    typeof context.sourceReports !== "object"
  ) {
    throw new Error(
      "The source reports are missing."
    );
  }

  const requiredSourceTypes = [
    OFF_AMAZON_SALES_CONFIG.sources.allegro.type,
    OFF_AMAZON_SALES_CONFIG.sources.cdiscount.type,
    OFF_AMAZON_SALES_CONFIG.sources.shopify.type
  ];

  const missingTypes = requiredSourceTypes.filter(
    function (sourceType) {
      return !context.sourceReports[sourceType];
    }
  );

  if (missingTypes.length > 0) {
    throw new Error(
      "The following source reports are missing:\n- " +
      missingTypes.join("\n- ")
    );
  }
}


function prepareOffAmazonSources_(sourceReports) {
  const configurations = [
    OFF_AMAZON_SALES_CONFIG.sources.allegro,
    OFF_AMAZON_SALES_CONFIG.sources.cdiscount,
    OFF_AMAZON_SALES_CONFIG.sources.shopify
  ];

  return configurations.map(function (sourceConfig) {
    return prepareOffAmazonSource_(
      sourceConfig,
      sourceReports[sourceConfig.type]
    );
  });
}


function prepareOffAmazonSource_(
  sourceConfig,
  sourceReference
) {
  if (
    !sourceReference ||
    !sourceReference.sourceSpreadsheetId
  ) {
    throw new Error(
      'The source Google Sheet for "' +
      sourceConfig.type +
      '" is missing.'
    );
  }

  const spreadsheet = openOffAmazonSourceSpreadsheet_(
    sourceReference.sourceSpreadsheetId,
    sourceConfig.type
  );

  const sheets = spreadsheet.getSheets();

  if (sheets.length !== 1) {
    throw new Error(
      'The source Google Sheet for "' +
      sourceConfig.type +
      '" must contain exactly one sheet. ' +
      "The selected source contains " +
      sheets.length +
      " sheets."
    );
  }

  /*
   * Для Allegro читаем отображаемые значения, а не только внутренние
   * значения ячеек. В импортированном CSV сумма может храниться как
   * число 88.29, а знак валюты — в формате ячейки. getDisplayValues()
   * сохраняет строку вида "88.29 €".
   *
   * Shopify и Cdiscount продолжаем читать через getValues(), чтобы
   * даты и числовые значения сохраняли исходные типы.
   */
  const values =
    sourceConfig.type ===
    OFF_AMAZON_SALES_CONFIG.sources.allegro.type
      ? getOffAmazonSourceDisplayValues_(sheets[0])
      : getOffAmazonSourceValues_(sheets[0]);

  if (
    values.length <
    sourceConfig.headerRowIndex + 1
  ) {
    throw new Error(
      'The source report "' +
      sourceConfig.type +
      '" does not contain its expected header row.'
    );
  }

  const sourceHeaders =
    values[sourceConfig.headerRowIndex];

  if (
    !Array.isArray(sourceHeaders) ||
    sourceHeaders.length === 0
  ) {
    throw new Error(
      'The header row in "' +
      sourceConfig.type +
      '" is empty.'
    );
  }

  const filterColumnIndex = findOffAmazonColumn_(
    sourceHeaders,
    sourceConfig.filterColumn,
    sourceConfig.type
  );

  const dataRows = values.slice(
    sourceConfig.headerRowIndex + 1
  );

  const filteredSourceRows = filterOffAmazonRows_(
    dataRows,
    filterColumnIndex,
    sourceConfig
  );

  const projectedData = projectOffAmazonOutputColumns_(
    sourceHeaders,
    filteredSourceRows,
    sourceConfig.excludedOutputColumns || []
  );

  return {
    sourceType: sourceConfig.type,
    sheetName: sourceConfig.sheetName,
    headers: projectedData.headers,
    filteredRows: projectedData.rows,
    skippedRows:
      dataRows.length - filteredSourceRows.length
  };
}


function projectOffAmazonOutputColumns_(
  headers,
  rows,
  excludedHeaders
) {
  const excludedSet = new Set(
    excludedHeaders.map(function (header) {
      return normalizeOffAmazonHeader_(header);
    })
  );

  const includedIndexes = [];

  headers.forEach(function (header, index) {
    if (
      !excludedSet.has(
        normalizeOffAmazonHeader_(header)
      )
    ) {
      includedIndexes.push(index);
    }
  });

  if (includedIndexes.length === 0) {
    throw new Error(
      "All columns were excluded from a source sheet."
    );
  }

  return {
    headers: includedIndexes.map(function (index) {
      return headers[index];
    }),

    rows: rows.map(function (row) {
      return includedIndexes.map(function (index) {
        return row[index];
      });
    })
  };
}


function getOffAmazonSourceValues_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow === 0 || lastColumn === 0) {
    return [];
  }

  return sheet
    .getRange(1, 1, lastRow, lastColumn)
    .getValues();
}



/**
 * Возвращает отображаемые значения ячеек.
 *
 * Используется только для исходного отчёта Allegro, поскольку знак
 * валюты в колонках kwota, dostawa и saldo может храниться в формате
 * Google Sheets, а не непосредственно в значении ячейки.
 *
 * Пример:
 * getValues()        → 88.29
 * getDisplayValues() → "88.29 €"
 */
function getOffAmazonSourceDisplayValues_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow === 0 || lastColumn === 0) {
    return [];
  }

  return sheet
    .getRange(1, 1, lastRow, lastColumn)
    .getDisplayValues();
}


function filterOffAmazonRows_(
  rows,
  filterColumnIndex,
  sourceConfig
) {
  if (
    sourceConfig.type ===
    OFF_AMAZON_SALES_CONFIG.sources.allegro.type
  ) {
    return rows.filter(function (row) {
      return String(
        row[filterColumnIndex] || ""
      ).trim() !== "";
    });
  }

  if (
    sourceConfig.type ===
    OFF_AMAZON_SALES_CONFIG.sources.cdiscount.type
  ) {
    const allowedValues = new Set(
      sourceConfig.allowedValues.map(function (value) {
        return normalizeOffAmazonValue_(value);
      })
    );

    return rows.filter(function (row) {
      const value = normalizeOffAmazonValue_(
        row[filterColumnIndex]
      );

      return value !== "" && allowedValues.has(value);
    });
  }

  if (
    sourceConfig.type ===
    OFF_AMAZON_SALES_CONFIG.sources.shopify.type
  ) {
    const excludedValue = normalizeOffAmazonValue_(
      sourceConfig.excludedValue
    );

    return rows.filter(function (row) {
      const value = normalizeOffAmazonValue_(
        row[filterColumnIndex]
      );

      return value !== "" && value !== excludedValue;
    });
  }

  throw new Error(
    'No row filter is configured for "' +
    sourceConfig.type +
    '".'
  );
}


/**
 * Сначала создаёт рабочие листы каналов,
 * затем анализирует именно эти новые листы.
 */
function buildOffAmazonWorkbook_(
  spreadsheet,
  sourceResults
) {
  const outputSheet = spreadsheet.getSheets()[0];

  outputSheet.setName(
    OFF_AMAZON_SALES_CONFIG.outputSheetName
  );

  ensureOffAmazonSheetSize_(
    outputSheet,
    1,
    OFF_AMAZON_SALES_CONFIG.outputHeaders.length
  );

  outputSheet
    .getRange(
      1,
      1,
      1,
      OFF_AMAZON_SALES_CONFIG.outputHeaders.length
    )
    .setValues([
      OFF_AMAZON_SALES_CONFIG.outputHeaders
    ]);

  sourceResults.forEach(function (source) {
    const channelSheet = spreadsheet.insertSheet(
      source.sheetName
    );

    const outputValues = [source.headers].concat(
      source.filteredRows
    );

    ensureOffAmazonSheetSize_(
      channelSheet,
      outputValues.length,
      source.headers.length
    );

    const channelRange = channelSheet.getRange(
      1,
      1,
      outputValues.length,
      source.headers.length
    );

    /*
     * Для Allegro все значения рабочего листа записываем как текст.
     *
     * Даже если из исходной таблицы получено отображаемое значение
     * "88.29 €", обычный setValues() может снова распознать его как
     * число 88.29 и отбросить обозначение валюты. Формат TEXT должен
     * быть применён ДО записи значений.
     */
    if (
      source.sourceType ===
      OFF_AMAZON_SALES_CONFIG.sources.allegro.type
    ) {
      channelRange.setNumberFormat("@");
    }

    channelRange.setValues(outputValues);
  });

  SpreadsheetApp.flush();

  return appendOffAmazonRowsFromWorkbook_(
    spreadsheet,
    outputSheet
  );
}


function appendOffAmazonRowsFromWorkbook_(
  spreadsheet,
  outputSheet
) {
  const allegroResult = appendOffAmazonAllegroRows_(
    outputSheet,
    spreadsheet.getSheetByName(
      OFF_AMAZON_SALES_CONFIG.sources.allegro.sheetName
    )
  );

  const cdiscountResult = appendOffAmazonCdiscountRows_(
    outputSheet,
    spreadsheet.getSheetByName(
      OFF_AMAZON_SALES_CONFIG.sources.cdiscount.sheetName
    )
  );

  const shopifyResult = appendOffAmazonShopifyRows_(
    outputSheet,
    spreadsheet.getSheetByName(
      OFF_AMAZON_SALES_CONFIG.sources.shopify.sheetName
    )
  );

  return {
    allegroSkippedRows:
      allegroResult.skippedRows,
    cdiscountSkippedRows:
      cdiscountResult.skippedRows,
    shopifySkippedRows:
      shopifyResult.skippedRows
  };
}


/**
 * Заполняет строки Allegro на листе off-amazon sales.
 *
 * Операции:
 * - wpłata → B2C SALE;
 * - zwrot → REFUND.
 *
 * Валюты:
 * - PLN / zł → PL, VAT 23%, REGULAR, польский VAT number;
 * - CZK / Kč → CZ, VAT 21%, UNION-OSS, эстонский OSS VAT;
 * - EUR / € → SK, VAT 20%, UNION-OSS, эстонский OSS VAT;
 * - HUF / Ft → HU, VAT 27%, UNION-OSS, эстонский OSS VAT.
 *
 * @return {{writtenRows: number, skippedRows: number}}
 */
function appendOffAmazonAllegroRows_(
  outputSheet,
  sourceSheet
) {
  if (!sourceSheet) {
    throw new Error(
      'The sheet "Allegro" was not found in the generated workbook.'
    );
  }

  const values = getOffAmazonSourceValues_(sourceSheet);

  if (values.length < 2) {
    return {
      writtenRows: 0,
      skippedRows: 0
    };
  }

  const headers = values[0];
  const allegroConfig =
    OFF_AMAZON_SALES_CONFIG.sources.allegro;

  const allegroRequiredColumns =
    Array.isArray(allegroConfig.requiredColumns)
      ? allegroConfig.requiredColumns
      : [];

  if (allegroRequiredColumns.length === 0) {
    throw new Error(
      "The Allegro configuration does not define requiredColumns."
    );
  }

  allegroRequiredColumns.forEach(
    function (requiredColumn) {
      findOffAmazonColumn_(
        headers,
        requiredColumn,
        "Allegro sheet"
      );
    }
  );

  const columnIndexes = {
    transactionDate: findOffAmazonColumn_(
      headers,
      "data",
      "Allegro sheet"
    ),
    transactionId: findOffAmazonColumn_(
      headers,
      "identyfikator",
      "Allegro sheet"
    ),
    operation: findOffAmazonColumn_(
      headers,
      "operacja",
      "Allegro sheet"
    ),
    buyer: findOffAmazonColumn_(
      headers,
      "kupujący",
      "Allegro sheet"
    ),
    amount: findOffAmazonColumn_(
      headers,
      "kwota",
      "Allegro sheet"
    )
  };

  const outputRows = [];
  let skippedRows = 0;

  for (
    let rowIndex = 1;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const sourceRow = values[rowIndex];
    const sheetRowNumber = rowIndex + 1;

    if (isOffAmazonRowEmpty_(sourceRow)) {
      continue;
    }

    const transactionId = String(
      sourceRow[columnIndexes.transactionId] || ""
    ).trim();

    if (!transactionId) {
      throw new Error(
        "The Allegro sheet contains an empty identyfikator in row " +
        sheetRowNumber +
        "."
      );
    }

    const buyer = String(
      sourceRow[columnIndexes.buyer] || ""
    ).trim();

    if (!buyer) {
      skippedRows += 1;
      continue;
    }

    const normalizedOperation = normalizeOffAmazonValue_(
      sourceRow[columnIndexes.operation]
    );

    let transactionType;

    if (normalizedOperation === "wpłata") {
      transactionType =
        OFF_AMAZON_SALES_CONFIG.allegroSaleTransactionType;
    } else if (normalizedOperation === "zwrot") {
      transactionType =
        OFF_AMAZON_SALES_CONFIG.allegroRefundTransactionType;
    } else {
      throw new Error(
        'The Allegro sheet contains an unsupported operacja "' +
        String(
          sourceRow[columnIndexes.operation] || ""
        ).trim() +
        '" in row ' +
        sheetRowNumber +
        ' for transaction "' +
        transactionId +
        '".'
      );
    }

    const transactionDate = parseOffAmazonAllegroDate_(
      sourceRow[columnIndexes.transactionDate],
      sheetRowNumber,
      transactionId
    );

    const amountResult = parseOffAmazonAllegroAmount_(
      sourceRow[columnIndexes.amount],
      sheetRowNumber,
      transactionId
    );

    const currencyRule =
      OFF_AMAZON_SALES_CONFIG.allegroCurrencyRules[
        amountResult.currency
      ];

    if (!currencyRule) {
      throw new Error(
        'No Allegro configuration exists for currency "' +
        amountResult.currency +
        '".'
      );
    }

    const absoluteAmount = Math.abs(
      amountResult.amount
    );

    const total = roundOffAmazonAmount_(
      transactionType ===
      OFF_AMAZON_SALES_CONFIG.allegroRefundTransactionType
        ? -absoluteAmount
        : absoluteAmount
    );

    const vatAmount = roundOffAmazonAmount_(
      total *
      currencyRule.vatRate /
      (1 + currencyRule.vatRate)
    );

    const netAmount = roundOffAmazonAmount_(
      total - vatAmount
    );

    const outputRow = [
      OFF_AMAZON_SALES_CONFIG.allegroChannelName,
      transactionDate,
      transactionType,
      currencyRule.currency,
      currencyRule.vatRate,
      vatAmount,
      netAmount,
      total,
      OFF_AMAZON_SALES_CONFIG.allegroDepartureCountry,
      currencyRule.arrivalCountry,
      currencyRule.sellerVatNumber,
      "",
      currencyRule.taxReportingScheme
    ];

    if (
      outputRow.length !==
      OFF_AMAZON_SALES_CONFIG.outputHeaders.length
    ) {
      throw new Error(
        "The Allegro output row has an invalid number of columns."
      );
    }

    outputRows.push(outputRow);
  }

  if (outputRows.length === 0) {
    return {
      writtenRows: 0,
      skippedRows: skippedRows
    };
  }

  const targetStartRow = Math.max(
    outputSheet.getLastRow() + 1,
    2
  );

  ensureOffAmazonSheetSize_(
    outputSheet,
    targetStartRow + outputRows.length - 1,
    OFF_AMAZON_SALES_CONFIG.outputHeaders.length
  );

  outputSheet
    .getRange(
      targetStartRow,
      1,
      outputRows.length,
      OFF_AMAZON_SALES_CONFIG.outputHeaders.length
    )
    .setValues(outputRows);

  applyOffAmazonAllegroFormats_(
    outputSheet,
    targetStartRow,
    outputRows.length
  );

  return {
    writtenRows: outputRows.length,
    skippedRows: skippedRows
  };
}


/**
 * Заполняет строки Cdiscount на листе off-amazon sales.
 *
 * Обрабатываются строки:
 * - Invoice type = Vente → B2C SALE;
 * - Invoice type = Remboursement client → REFUND.
 *
 * @return {{writtenRows: number, skippedRows: number}}
 */
function appendOffAmazonCdiscountRows_(
  outputSheet,
  sourceSheet
) {
  if (!sourceSheet) {
    throw new Error(
      'The sheet "Cdiscount" was not found in the generated workbook.'
    );
  }

  const values = getOffAmazonSourceValues_(sourceSheet);

  if (values.length < 2) {
    return {
      writtenRows: 0,
      skippedRows: 0
    };
  }

  const headers = values[0];
  const cdiscountConfig =
    OFF_AMAZON_SALES_CONFIG.sources.cdiscount;

  const cdiscountRequiredColumns =
    Array.isArray(cdiscountConfig.requiredColumns)
      ? cdiscountConfig.requiredColumns
      : [];

  if (cdiscountRequiredColumns.length === 0) {
    throw new Error(
      "The Cdiscount configuration does not define requiredColumns."
    );
  }

  cdiscountRequiredColumns.forEach(
    function (requiredColumn) {
      findOffAmazonColumn_(
        headers,
        requiredColumn,
        "Cdiscount sheet"
      );
    }
  );

  const columnIndexes = {
    id: findOffAmazonColumn_(
      headers,
      "Invoice/Refund Id",
      "Cdiscount sheet"
    ),
    invoiceType: findOffAmazonColumn_(
      headers,
      "Invoice type",
      "Cdiscount sheet"
    ),
    accountingDate: findOffAmazonColumn_(
      headers,
      "Accounting date",
      "Cdiscount sheet"
    ),
    grossAmount: findOffAmazonColumn_(
      headers,
      "Gross amount",
      "Cdiscount sheet"
    )
  };

  const outputRows = [];
  let skippedRows = 0;

  for (
    let rowIndex = 1;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const sourceRow = values[rowIndex];
    const sheetRowNumber = rowIndex + 1;

    if (isOffAmazonRowEmpty_(sourceRow)) {
      continue;
    }

    const invoiceId = String(
      sourceRow[columnIndexes.id] || ""
    ).trim();

    if (!invoiceId) {
      throw new Error(
        "The Cdiscount sheet contains an empty Invoice/Refund Id " +
        "in row " +
        sheetRowNumber +
        "."
      );
    }

    const invoiceType = normalizeOffAmazonValue_(
      sourceRow[columnIndexes.invoiceType]
    );

    let transactionType;

    if (invoiceType === "vente") {
      transactionType =
        OFF_AMAZON_SALES_CONFIG.cdiscountTransactionType;
    } else if (invoiceType === "remboursement client") {
      transactionType = "REFUND";
    } else {
      skippedRows += 1;
      continue;
    }

    const transactionDate = parseOffAmazonCdiscountDate_(
      sourceRow[columnIndexes.accountingDate],
      sheetRowNumber,
      invoiceId
    );

    const grossAmount = parseOffAmazonCdiscountNumber_(
      sourceRow[columnIndexes.grossAmount],
      "Gross amount",
      sheetRowNumber,
      invoiceId
    );

    const total = roundOffAmazonAmount_(
      Math.abs(grossAmount)
    );

    const vatAmount = roundOffAmazonAmount_(
      total *
      OFF_AMAZON_SALES_CONFIG.cdiscountVatRate /
      (1 + OFF_AMAZON_SALES_CONFIG.cdiscountVatRate)
    );

    const netAmount = roundOffAmazonAmount_(
      total - vatAmount
    );

    const outputRow = [
      OFF_AMAZON_SALES_CONFIG.cdiscountChannelName,
      transactionDate,
      transactionType,
      OFF_AMAZON_SALES_CONFIG.cdiscountCurrency,
      OFF_AMAZON_SALES_CONFIG.cdiscountVatRate,
      vatAmount,
      netAmount,
      total,
      OFF_AMAZON_SALES_CONFIG.cdiscountDepartureCountry,
      OFF_AMAZON_SALES_CONFIG.cdiscountArrivalCountry,
      OFF_AMAZON_SALES_CONFIG.cdiscountSellerVatNumber,
      "",
      OFF_AMAZON_SALES_CONFIG.cdiscountTaxReportingScheme
    ];

    if (
      outputRow.length !==
      OFF_AMAZON_SALES_CONFIG.outputHeaders.length
    ) {
      throw new Error(
        "The Cdiscount output row has an invalid number of columns."
      );
    }

    outputRows.push(outputRow);
  }

  if (outputRows.length === 0) {
    return {
      writtenRows: 0,
      skippedRows: skippedRows
    };
  }

  const targetStartRow = Math.max(
    outputSheet.getLastRow() + 1,
    2
  );

  ensureOffAmazonSheetSize_(
    outputSheet,
    targetStartRow + outputRows.length - 1,
    OFF_AMAZON_SALES_CONFIG.outputHeaders.length
  );

  outputSheet
    .getRange(
      targetStartRow,
      1,
      outputRows.length,
      OFF_AMAZON_SALES_CONFIG.outputHeaders.length
    )
    .setValues(outputRows);

  applyOffAmazonCdiscountFormats_(
    outputSheet,
    targetStartRow,
    outputRows.length
  );

  return {
    writtenRows: outputRows.length,
    skippedRows: skippedRows
  };
}


/**
 * Полностью заполняет строки Shopify на листе off-amazon sales.
 *
 * Все данные читаются из листа Shopify внутри уже созданной таблицы.
 * Все строки с arrival country = CH пропускаются.
 *
 * @return {{writtenRows: number, skippedRows: number}}
 */
function appendOffAmazonShopifyRows_(
  outputSheet,
  sourceSheet
) {
  if (!sourceSheet) {
    throw new Error(
      'The sheet "Shopify" was not found in the generated workbook.'
    );
  }

  const values = getOffAmazonSourceValues_(
    sourceSheet
  );

  if (values.length < 2) {
    return {
      writtenRows: 0,
      skippedRows: 0
    };
  }

  const headers = values[0];
  const shopifyConfig =
    OFF_AMAZON_SALES_CONFIG.sources.shopify;

  const shopifyRequiredColumns =
    Array.isArray(shopifyConfig.requiredColumns)
      ? shopifyConfig.requiredColumns
      : [];

  if (shopifyRequiredColumns.length === 0) {
    throw new Error(
      "The Shopify configuration does not define requiredColumns."
    );
  }

  shopifyRequiredColumns.forEach(
    function (requiredColumn) {
      findOffAmazonColumn_(
        headers,
        requiredColumn,
        "Shopify sheet"
      );
    }
  );

  const columnIndexes = {
    name: findOffAmazonColumn_(
      headers,
      "Name",
      "Shopify sheet"
    ),
    createdAt: findOffAmazonColumn_(
      headers,
      "Created at",
      "Shopify sheet"
    ),
    taxes: findOffAmazonColumn_(
      headers,
      "Taxes",
      "Shopify sheet"
    ),
    total: findOffAmazonColumn_(
      headers,
      "Total",
      "Shopify sheet"
    ),
    shippingCountry: findOffAmazonColumn_(
      headers,
      "Shipping Country",
      "Shopify sheet"
    ),
    billingCountry: findOffAmazonColumn_(
      headers,
      "Billing Country",
      "Shopify sheet"
    ),
    tax1Name: findOffAmazonColumn_(
      headers,
      "Tax 1 Name",
      "Shopify sheet"
    ),
    source: findOffAmazonColumn_(
      headers,
      "Source",
      "Shopify sheet"
    )
  };

  const outputRows = [];
  const missingVatRateOutputOffsets = [];
  let skippedRows = 0;

  for (
    let rowIndex = 1;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const sourceRow = values[rowIndex];
    const sheetRowNumber = rowIndex + 1;

    if (isOffAmazonRowEmpty_(sourceRow)) {
      continue;
    }

    const orderName = String(
      sourceRow[columnIndexes.name] || ""
    ).trim();

    if (!orderName) {
      throw new Error(
        "The Shopify sheet contains an empty Name value in row " +
        sheetRowNumber +
        "."
      );
    }

    const rawCreatedAt =
      sourceRow[columnIndexes.createdAt];

    if (
      rawCreatedAt === "" ||
      rawCreatedAt === null ||
      typeof rawCreatedAt === "undefined"
    ) {
      throw new Error(
        "The Shopify sheet contains an empty Created at value in row " +
        sheetRowNumber +
        ' for order "' +
        orderName +
        '".'
      );
    }

    const arrivalCountry = normalizeOffAmazonCountry_(
      sourceRow[columnIndexes.shippingCountry] ||
      sourceRow[columnIndexes.billingCountry]
    );

    if (!arrivalCountry) {
      throw new Error(
        "The Shopify sheet contains no Shipping Country or Billing Country " +
        "in row " +
        sheetRowNumber +
        ' for order "' +
        orderName +
        '".'
      );
    }

    // По ТЗ пропускаются абсолютно все строки Швейцарии.
    if (arrivalCountry === "CH") {
      skippedRows += 1;
      continue;
    }

    const transactionDate = parseOffAmazonShopifyDate_(
      rawCreatedAt,
      sheetRowNumber,
      orderName
    );

    const total = parseOffAmazonNumber_(
      sourceRow[columnIndexes.total],
      "Total",
      sheetRowNumber,
      false
    );

    const sourceVatAmount = parseOffAmazonNumber_(
      sourceRow[columnIndexes.taxes],
      "Taxes",
      sheetRowNumber,
      true
    );

    const taxName = String(
      sourceRow[columnIndexes.tax1Name] || ""
    ).trim();

    const vatRateResult = determineShopifyVatRate_(
      taxName,
      arrivalCountry
    );

    const vatAmount = determineShopifyVatAmount_(
      sourceVatAmount,
      total,
      vatRateResult,
      arrivalCountry
    );

    const netAmount = roundOffAmazonAmount_(
      total - vatAmount
    );

    const departureCountry =
      OFF_AMAZON_SALES_CONFIG.departureCountry;

    const taxReportingScheme =
      departureCountry === arrivalCountry
        ? OFF_AMAZON_SALES_CONFIG.regularScheme
        : OFF_AMAZON_SALES_CONFIG.unionOssScheme;

    const sellerVatNumber =
      taxReportingScheme ===
      OFF_AMAZON_SALES_CONFIG.regularScheme
        ? OFF_AMAZON_SALES_CONFIG
            .sellerVatNumbers[departureCountry]
        : OFF_AMAZON_SALES_CONFIG.ossVatNumber;

    if (!sellerVatNumber) {
      throw new Error(
        "No seller VAT number is configured for row " +
        sheetRowNumber +
        ' and order "' +
        orderName +
        '".'
      );
    }

    const outputRow = [
      OFF_AMAZON_SALES_CONFIG.shopifyChannelName,
      transactionDate,
      OFF_AMAZON_SALES_CONFIG.shopifyTransactionType,
      OFF_AMAZON_SALES_CONFIG.shopifyCurrency,
      vatRateResult.value,
      vatAmount,
      netAmount,
      total,
      departureCountry,
      arrivalCountry,
      sellerVatNumber,
      "",
      taxReportingScheme
    ];

    if (
      outputRow.length !==
      OFF_AMAZON_SALES_CONFIG.outputHeaders.length
    ) {
      throw new Error(
        "The Shopify output row has an invalid number of columns."
      );
    }

    if (vatRateResult.missing) {
      missingVatRateOutputOffsets.push(
        outputRows.length
      );
    }

    outputRows.push(outputRow);
  }

  if (outputRows.length === 0) {
    return {
      writtenRows: 0,
      skippedRows: skippedRows
    };
  }

  const targetStartRow = Math.max(
    outputSheet.getLastRow() + 1,
    2
  );

  ensureOffAmazonSheetSize_(
    outputSheet,
    targetStartRow + outputRows.length - 1,
    OFF_AMAZON_SALES_CONFIG.outputHeaders.length
  );

  outputSheet
    .getRange(
      targetStartRow,
      1,
      outputRows.length,
      OFF_AMAZON_SALES_CONFIG.outputHeaders.length
    )
    .setValues(outputRows);

  applyOffAmazonShopifyFormats_(
    outputSheet,
    targetStartRow,
    outputRows.length
  );

  highlightMissingShopifyVatRates_(
    outputSheet,
    targetStartRow,
    missingVatRateOutputOffsets
  );

  return {
    writtenRows: outputRows.length,
    skippedRows: skippedRows
  };
}


/**
 * Преобразует дату Allegro из dd.MM.yyyy HH:mm
 * в настоящий объект Date без времени.
 */
function parseOffAmazonAllegroDate_(
  value,
  sheetRowNumber,
  transactionId
) {
  if (
    Object.prototype.toString.call(value) ===
      "[object Date]" &&
    !isNaN(value.getTime())
  ) {
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate()
    );
  }

  const text = String(value || "").trim();
  const match = text.match(
    /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$/
  );

  if (!match) {
    throw new Error(
      'The Allegro sheet contains an invalid data value "' +
      text +
      '" in row ' +
      sheetRowNumber +
      ' for transaction "' +
      transactionId +
      '". Expected format: dd.MM.yyyy HH:mm.'
    );
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = match[4] === undefined
    ? 0
    : Number(match[4]);
  const minute = match[5] === undefined
    ? 0
    : Number(match[5]);

  if (
    year < 1900 ||
    year > 9999 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(
      'The Allegro sheet contains an invalid data value "' +
      text +
      '" in row ' +
      sheetRowNumber +
      ' for transaction "' +
      transactionId +
      '".'
    );
  }

  const validationDate = new Date(
    Date.UTC(year, month - 1, day, hour, minute)
  );

  if (
    validationDate.getUTCFullYear() !== year ||
    validationDate.getUTCMonth() !== month - 1 ||
    validationDate.getUTCDate() !== day ||
    validationDate.getUTCHours() !== hour ||
    validationDate.getUTCMinutes() !== minute
  ) {
    throw new Error(
      'The Allegro sheet contains a non-existent data value "' +
      text +
      '" in row ' +
      sheetRowNumber +
      ' for transaction "' +
      transactionId +
      '".'
    );
  }

  return new Date(year, month - 1, day);
}


/**
 * Извлекает числовую сумму и валюту из kwota Allegro.
 *
 * Поддерживаемые валюты:
 * - zł / PLN;
 * - Kč / CZK;
 * - € / EUR;
 * - Ft / HUF.
 *
 * @return {{amount: number, currency: string}}
 */
function parseOffAmazonAllegroAmount_(
  value,
  sheetRowNumber,
  transactionId
) {
  const text = String(
    value === null ||
    typeof value === "undefined"
      ? ""
      : value
  ).trim();

  if (!text || text === "-") {
    throw new Error(
      "The Allegro sheet contains an empty kwota value in row " +
      sheetRowNumber +
      ' for transaction "' +
      transactionId +
      '".'
    );
  }

  const currency = detectOffAmazonAllegroCurrency_(
    text,
    sheetRowNumber,
    transactionId
  );

  let numericText = text
    .replace(/\u00A0/g, "")
    .replace(/\s/g, "")
    .replace(/PLN/gi, "")
    .replace(/CZK/gi, "")
    .replace(/EUR/gi, "")
    .replace(/HUF/gi, "")
    .replace(/zł/gi, "")
    .replace(/Kč/gi, "")
    .replace(/Ft/gi, "")
    .replace(/€/g, "")
    .trim();

  const commaIndex = numericText.lastIndexOf(",");
  const dotIndex = numericText.lastIndexOf(".");

  if (commaIndex !== -1 && dotIndex !== -1) {
    if (commaIndex > dotIndex) {
      numericText = numericText
        .replace(/\./g, "")
        .replace(",", ".");
    } else {
      numericText = numericText.replace(/,/g, "");
    }
  } else if (commaIndex !== -1) {
    numericText = numericText.replace(",", ".");
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(numericText)) {
    throw new Error(
      'The Allegro sheet contains an invalid kwota value "' +
      text +
      '" in row ' +
      sheetRowNumber +
      ' for transaction "' +
      transactionId +
      '".'
    );
  }

  const amount = Number(numericText);

  if (!Number.isFinite(amount)) {
    throw new Error(
      'The Allegro sheet contains an invalid kwota value "' +
      text +
      '" in row ' +
      sheetRowNumber +
      ' for transaction "' +
      transactionId +
      '".'
    );
  }

  return {
    amount: amount,
    currency: currency
  };
}


function detectOffAmazonAllegroCurrency_(
  text,
  sheetRowNumber,
  transactionId
) {
  const normalizedText = String(text)
    .replace(/\u00A0/g, " ")
    .trim();

  if (/(?:zł|PLN)\s*$/i.test(normalizedText)) {
    return "PLN";
  }

  if (/(?:Kč|CZK)\s*$/i.test(normalizedText)) {
    return "CZK";
  }

  if (/(?:€|EUR)\s*$/i.test(normalizedText)) {
    return "EUR";
  }

  if (/(?:Ft|HUF)\s*$/i.test(normalizedText)) {
    return "HUF";
  }

  throw new Error(
    'The Allegro sheet contains an unsupported currency in kwota "' +
    normalizedText +
    '" in row ' +
    sheetRowNumber +
    ' for transaction "' +
    transactionId +
    '".'
  );
}


function applyOffAmazonAllegroFormats_(
  outputSheet,
  startRow,
  rowCount
) {
  if (rowCount <= 0) {
    return;
  }

  outputSheet
    .getRange(startRow, 2, rowCount, 1)
    .setNumberFormat(
      OFF_AMAZON_SALES_CONFIG.outputFormats.transactionDate
    );

  outputSheet
    .getRange(startRow, 5, rowCount, 1)
    .setNumberFormat(
      OFF_AMAZON_SALES_CONFIG.outputFormats.vatRate
    );

  outputSheet
    .getRange(startRow, 6, rowCount, 3)
    .setNumberFormat(
      OFF_AMAZON_SALES_CONFIG.outputFormats.amount
    );
}


/**
 * Преобразует Accounting date Cdiscount в настоящий объект Date.
 * Поддерживает объект Date и строку yyyy-MM-dd.
 */
function parseOffAmazonCdiscountDate_(
  value,
  sheetRowNumber,
  invoiceId
) {
  if (
    Object.prototype.toString.call(value) ===
      "[object Date]" &&
    !isNaN(value.getTime())
  ) {
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate()
    );
  }

  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error(
      "The Cdiscount sheet contains an invalid Accounting date " +
      "in row " +
      sheetRowNumber +
      ' for invoice "' +
      invoiceId +
      '": "' +
      text +
      '". Expected format: yyyy-MM-dd.'
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const validationDate = new Date(
    Date.UTC(year, month - 1, day)
  );

  if (
    year < 1900 ||
    year > 9999 ||
    validationDate.getUTCFullYear() !== year ||
    validationDate.getUTCMonth() !== month - 1 ||
    validationDate.getUTCDate() !== day
  ) {
    throw new Error(
      "The Cdiscount sheet contains an invalid Accounting date " +
      "in row " +
      sheetRowNumber +
      ' for invoice "' +
      invoiceId +
      '".'
    );
  }

  return new Date(year, month - 1, day);
}


function parseOffAmazonCdiscountNumber_(
  value,
  columnName,
  sheetRowNumber,
  invoiceId
) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  const text = String(
    value === null ||
    typeof value === "undefined"
      ? ""
      : value
  ).trim();

  if (!text) {
    throw new Error(
      'The Cdiscount sheet contains an empty "' +
      columnName +
      '" value in row ' +
      sheetRowNumber +
      ' for invoice "' +
      invoiceId +
      '".'
    );
  }

  let normalized = text
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "");

  const commaIndex = normalized.lastIndexOf(",");
  const dotIndex = normalized.lastIndexOf(".");

  if (commaIndex !== -1 && dotIndex !== -1) {
    if (commaIndex > dotIndex) {
      normalized = normalized
        .replace(/\./g, "")
        .replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (commaIndex !== -1) {
    normalized = normalized.replace(",", ".");
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error(
      'The Cdiscount sheet contains an invalid "' +
      columnName +
      '" value in row ' +
      sheetRowNumber +
      ' for invoice "' +
      invoiceId +
      '": "' +
      text +
      '".'
    );
  }

  const number = Number(normalized);

  if (!Number.isFinite(number)) {
    throw new Error(
      'The Cdiscount sheet contains an invalid "' +
      columnName +
      '" value in row ' +
      sheetRowNumber +
      ' for invoice "' +
      invoiceId +
      '".'
    );
  }

  return number;
}


function applyOffAmazonCdiscountFormats_(
  outputSheet,
  startRow,
  rowCount
) {
  outputSheet
    .getRange(startRow, 2, rowCount, 1)
    .setNumberFormat(
      OFF_AMAZON_SALES_CONFIG.outputFormats.transactionDate
    );

  outputSheet
    .getRange(startRow, 5, rowCount, 1)
    .setNumberFormat(
      OFF_AMAZON_SALES_CONFIG.outputFormats.vatRate
    );

  outputSheet
    .getRange(startRow, 6, rowCount, 3)
    .setNumberFormat(
      OFF_AMAZON_SALES_CONFIG.outputFormats.amount
    );
}


function determineShopifyVatRate_(
  taxName,
  arrivalCountry
) {
  const normalizedCountry = normalizeOffAmazonCountry_(
    arrivalCountry
  );

  // По ТЗ для UK/GB при отсутствии ставки вручную ставится 20%.
  if (
    (normalizedCountry === "GB" ||
      normalizedCountry === "UK") &&
    !String(taxName || "").trim()
  ) {
    return {
      value: 0.20,
      missing: false
    };
  }

  const text = String(taxName || "").trim();

  if (!text) {
    return {
      value: "",
      missing: true
    };
  }

  const match = text.match(
    /(-?\d+(?:[.,]\d+)?)\s*%/
  );

  if (!match) {
    return {
      value: "",
      missing: true
    };
  }

  const percentage = Number(
    match[1].replace(",", ".")
  );

  if (
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 100
  ) {
    return {
      value: "",
      missing: true
    };
  }

  return {
    value: percentage / 100,
    missing: false
  };
}


/**
 * Возвращает сумму НДС Shopify.
 *
 * Для GB Shopify иногда передаёт ставку 20%, но оставляет Taxes пустым
 * или равным нулю. В таком случае НДС рассчитывается из Total,
 * считая Total суммой с НДС:
 *
 * VAT = Total × rate / (1 + rate)
 *
 * Для остальных стран сохраняется сумма из колонки Taxes.
 */
function determineShopifyVatAmount_(
  sourceVatAmount,
  total,
  vatRateResult,
  arrivalCountry
) {
  const normalizedCountry =
    normalizeOffAmazonCountry_(arrivalCountry);

  const numericSourceVat =
    typeof sourceVatAmount === "number" &&
    Number.isFinite(sourceVatAmount)
      ? sourceVatAmount
      : 0;

  const vatRate =
    vatRateResult &&
    typeof vatRateResult.value === "number" &&
    Number.isFinite(vatRateResult.value)
      ? vatRateResult.value
      : null;

  if (
    normalizedCountry === "GB" &&
    numericSourceVat === 0 &&
    vatRate !== null &&
    vatRate > 0
  ) {
    return roundOffAmazonAmount_(
      total * vatRate / (1 + vatRate)
    );
  }

  return roundOffAmazonAmount_(
    numericSourceVat
  );
}


function applyOffAmazonShopifyFormats_(
  outputSheet,
  startRow,
  rowCount
) {
  outputSheet
    .getRange(startRow, 2, rowCount, 1)
    .setNumberFormat(
      OFF_AMAZON_SALES_CONFIG.outputFormats.transactionDate
    );

  outputSheet
    .getRange(startRow, 5, rowCount, 1)
    .setNumberFormat(
      OFF_AMAZON_SALES_CONFIG.outputFormats.vatRate
    );

  outputSheet
    .getRange(startRow, 6, rowCount, 3)
    .setNumberFormat(
      OFF_AMAZON_SALES_CONFIG.outputFormats.amount
    );
}


/**
 * Подсвечивает только ячейки VAT rate с отсутствующей ставкой.
 * RangeList позволяет применить цвет одним пакетным вызовом.
 */
function highlightMissingShopifyVatRates_(
  outputSheet,
  startRow,
  outputOffsets
) {
  if (outputOffsets.length === 0) {
    return;
  }

  const ranges = outputOffsets.map(function (offset) {
    return "E" + (startRow + offset);
  });

  outputSheet
    .getRangeList(ranges)
    .setBackground(
      OFF_AMAZON_SALES_CONFIG.missingVatRateBackground
    );
}


/**
 * Преобразует Shopify Created at в настоящий объект Date.
 *
 * Исходный формат:
 * yyyy-MM-dd HH:mm:ss +HHMM
 *
 * Берётся именно календарный день из строки, без пересчёта timezone.
 */
function parseOffAmazonShopifyDate_(
  value,
  sheetRowNumber,
  orderName
) {
  if (
    Object.prototype.toString.call(value) ===
      "[object Date]" &&
    !isNaN(value.getTime())
  ) {
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate()
    );
  }

  const text = String(value || "").trim();

  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-])(\d{2})(\d{2})$/
  );

  if (!match) {
    throw new Error(
      "The Shopify sheet contains an invalid Created at value in row " +
      sheetRowNumber +
      ' for order "' +
      orderName +
      '": "' +
      text +
      '". Expected format: yyyy-MM-dd HH:mm:ss +HHMM.'
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[8]);
  const offsetMinute = Number(match[9]);

  if (
    year < 1900 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59 ||
    offsetHour < 0 ||
    offsetHour > 14 ||
    offsetMinute < 0 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    throw new Error(
      "The Shopify sheet contains an invalid Created at value in row " +
      sheetRowNumber +
      ' for order "' +
      orderName +
      '".'
    );
  }

  const validationDate = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      hour,
      minute,
      second
    )
  );

  if (
    validationDate.getUTCFullYear() !== year ||
    validationDate.getUTCMonth() !== month - 1 ||
    validationDate.getUTCDate() !== day ||
    validationDate.getUTCHours() !== hour ||
    validationDate.getUTCMinutes() !== minute ||
    validationDate.getUTCSeconds() !== second
  ) {
    throw new Error(
      "The Shopify sheet contains a non-existent Created at date in row " +
      sheetRowNumber +
      ' for order "' +
      orderName +
      '".'
    );
  }

  return new Date(year, month - 1, day);
}


function parseOffAmazonNumber_(
  value,
  columnName,
  sheetRowNumber,
  allowEmptyAsZero
) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  const text = String(
    value === null ||
    typeof value === "undefined"
      ? ""
      : value
  ).trim();

  if (!text) {
    if (allowEmptyAsZero) {
      return 0;
    }

    throw new Error(
      'The Shopify sheet contains an empty "' +
      columnName +
      '" value in row ' +
      sheetRowNumber +
      "."
    );
  }

  let normalized = text
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "");

  const commaIndex = normalized.lastIndexOf(",");
  const dotIndex = normalized.lastIndexOf(".");

  if (commaIndex !== -1 && dotIndex !== -1) {
    if (commaIndex > dotIndex) {
      normalized = normalized
        .replace(/\./g, "")
        .replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (commaIndex !== -1) {
    normalized = normalized.replace(",", ".");
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error(
      'The Shopify sheet contains an invalid "' +
      columnName +
      '" value in row ' +
      sheetRowNumber +
      ': "' +
      text +
      '".'
    );
  }

  const number = Number(normalized);

  if (!Number.isFinite(number)) {
    throw new Error(
      'The Shopify sheet contains an invalid "' +
      columnName +
      '" value in row ' +
      sheetRowNumber +
      "."
    );
  }

  return number;
}


function roundOffAmazonAmount_(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}


function normalizeOffAmazonCountry_(value) {
  const country = String(value || "")
    .replace(/\u00A0/g, " ")
    .trim()
    .toUpperCase();

  if (country === "UK") {
    return "GB";
  }

  return country;
}


function isOffAmazonRowEmpty_(row) {
  return !row.some(function (value) {
    return String(
      value === null ||
      typeof value === "undefined"
        ? ""
        : value
    ).trim() !== "";
  });
}


function findOffAmazonColumn_(
  headers,
  requiredHeader,
  sourceType
) {
  const expected = normalizeOffAmazonHeader_(
    requiredHeader
  );

  const columnIndex = headers.findIndex(
    function (header) {
      return (
        normalizeOffAmazonHeader_(header) ===
        expected
      );
    }
  );

  if (columnIndex === -1) {
    throw new Error(
      "The " +
      sourceType +
      ' is missing the required column "' +
      requiredHeader +
      '".'
    );
  }

  return columnIndex;
}


function normalizeOffAmazonHeader_(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase();
}


function normalizeOffAmazonValue_(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase();
}


function openOffAmazonSourceSpreadsheet_(
  spreadsheetId,
  sourceType
) {
  try {
    return SpreadsheetApp.openById(
      spreadsheetId
    );
  } catch (error) {
    throw new Error(
      'The source Google Sheet for "' +
      sourceType +
      '" could not be opened. Check that the file exists ' +
      "and that you have access to it."
    );
  }
}


function getOffAmazonDestinationFolder_(folderId) {
  try {
    return DriveApp.getFolderById(folderId);
  } catch (error) {
    throw new Error(
      "The Off-Amazon Sales destination folder could not be opened."
    );
  }
}


function ensureOffAmazonSheetSize_(
  sheet,
  requiredRows,
  requiredColumns
) {
  const currentRows = sheet.getMaxRows();
  const currentColumns = sheet.getMaxColumns();

  if (requiredRows > currentRows) {
    sheet.insertRowsAfter(
      currentRows,
      requiredRows - currentRows
    );
  }

  if (requiredColumns > currentColumns) {
    sheet.insertColumnsAfter(
      currentColumns,
      requiredColumns - currentColumns
    );
  }
}


function getOffAmazonErrorMessage_(error) {
  if (
    error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }

  return "An unexpected error occurred.";
}