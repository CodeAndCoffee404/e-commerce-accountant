/**
 * Создаёт лист Exceptions.
 *
 * В Exceptions попадают:
 *
 * 1. Строки с TAX_REPORTING_SCHEME,
 *    отличным от REGULAR и UNION-OSS.
 *
 * 2. Строки REGULAR, которые невозможно обработать.
 *
 * 3. Строки UNION-OSS, которые невозможно обработать.
 *
 * Из Exceptions полностью исключаются строки:
 *
 * - SALES_CHANNEL = AMAZON_FEE
 * - TRANSACTION_TYPE = FC_TRANSFER
 * - TRANSACTION_TYPE = INBOUND
 * - TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL пустое
 * - TAX_COLLECTION_RESPONSIBILITY = MARKETPLACE
 *
 * @param {Object} vatContext
 * @param {Object} context
 * @return {Object}
 */
function createExceptionsSheet(
  vatContext,
  context
) {
  if (
    !vatContext ||
    !Array.isArray(vatContext.rows) ||
    !Array.isArray(vatContext.originalHeaders)
  ) {
    throw new Error(
      'ExceptionsSheet: некорректный VatDataContext.'
    );
  }

  const spreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  const exceptionsData = [
    ['EXCEPTION_REASON'].concat(
      vatContext.originalHeaders
    )
  ];

  let ignoredAmazonFeeRowsCount = 0;
  let ignoredFcTransferRowsCount = 0;
  let ignoredInboundRowsCount = 0;
  let ignoredEmptyAmountRowsCount = 0;
  let ignoredMarketplaceRowsCount = 0;

  vatContext.rows.forEach(function (row) {
    /*
     * Эти строки не должны попадать
     * в Exceptions независимо от остальных полей.
     */
    if (
      row.salesChannel === 'AMAZON_FEE'
    ) {
      ignoredAmazonFeeRowsCount++;
      return;
    }

    if (
      row.transactionType === 'FC_TRANSFER'
    ) {
      ignoredFcTransferRowsCount++;
      return;
    }

    if (
      row.transactionType === 'INBOUND'
    ) {
      ignoredInboundRowsCount++;
      return;
    }

    if (row.amountIsEmpty) {
      ignoredEmptyAmountRowsCount++;
      return;
    }

    if (
      row.taxCollectionResponsibility ===
      'MARKETPLACE'
    ) {
      ignoredMarketplaceRowsCount++;
      return;
    }

    const exceptionReasons = [];

    /*
     * Неизвестная или пустая схема.
     */
    if (
      row.reportingScheme !== 'REGULAR' &&
      row.reportingScheme !== 'UNION-OSS'
    ) {
      exceptionReasons.push(
        row.reportingScheme === ''
          ? 'TAX_REPORTING_SCHEME is empty'
          : 'Unsupported TAX_REPORTING_SCHEME: ' +
            row.reportingScheme
      );
    }

    /*
     * Проверки REGULAR.
     */
    if (
      row.reportingScheme === 'REGULAR'
    ) {
      if (row.sellerVatNumber === '') {
        exceptionReasons.push(
          'TRANSACTION_SELLER_VAT_NUMBER is empty'
        );
      }

      if (row.amount === null) {
        exceptionReasons.push(
          'Invalid TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL'
        );
      }

      if (row.vatRate === null) {
        exceptionReasons.push(
          'Invalid PRICE_OF_ITEMS_VAT_RATE_PERCENT'
        );
      } else if (row.vatRate <= -1) {
        exceptionReasons.push(
          'PRICE_OF_ITEMS_VAT_RATE_PERCENT must be greater than -1'
        );
      }
    }

    /*
     * Проверки UNION-OSS.
     */
    if (
      row.reportingScheme === 'UNION-OSS'
    ) {
      if (
        row.taxableJurisdiction === ''
      ) {
        exceptionReasons.push(
          'TAXABLE_JURISDICTION is empty'
        );
      }

      if (row.amount === null) {
        exceptionReasons.push(
          'Invalid TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL'
        );
      }

      if (row.vatRate === null) {
        exceptionReasons.push(
          'Invalid PRICE_OF_ITEMS_VAT_RATE_PERCENT'
        );
      } else if (row.vatRate <= -1) {
        exceptionReasons.push(
          'PRICE_OF_ITEMS_VAT_RATE_PERCENT must be greater than -1'
        );
      }
    }

    if (exceptionReasons.length === 0) {
      return;
    }

    exceptionsData.push(
      [
        exceptionReasons.join('; ')
      ].concat(row.sourceRow.slice())
    );
  });

  const baseName =
    'Exceptions — ' +
    context.sheetDateLabel;

  let sheetName =
    baseName.substring(0, 100);

  let sequence = 2;

  while (
    spreadsheet.getSheetByName(sheetName)
  ) {
    const suffix =
      ' (' + sequence + ')';

    sheetName =
      baseName.substring(
        0,
        100 - suffix.length
      ) + suffix;

    sequence++;
  }

  const sheet =
    spreadsheet.insertSheet(sheetName);

  sheet
    .getRange(
      1,
      1,
      exceptionsData.length,
      exceptionsData[0].length
    )
    .setValues(exceptionsData);

  /*
   * Выделяем EXCEPTION_REASON.
   */
  sheet
    .getRange(
      1,
      1,
      exceptionsData.length,
      1
    )
    .setBackground('#f4cccc');

  /*
   * Выделяем TAX_REPORTING_SCHEME.
   *
   * В итоговой таблице добавлен первый столбец
   * EXCEPTION_REASON, поэтому индекс смещается.
   */
  const reportingSchemeOutputColumn =
    vatContext.indexes.reportingScheme + 2;

  sheet
    .getRange(
      1,
      reportingSchemeOutputColumn,
      exceptionsData.length,
      1
    )
    .setBackground('#fce5cd');

  return {
    sheetName: sheetName,

    rowCount: Math.max(
      exceptionsData.length - 1,
      0
    ),

    ignoredAmazonFeeRowsCount:
      ignoredAmazonFeeRowsCount,

    ignoredFcTransferRowsCount:
      ignoredFcTransferRowsCount,

    ignoredInboundRowsCount:
      ignoredInboundRowsCount,

    ignoredEmptyAmountRowsCount:
      ignoredEmptyAmountRowsCount,

    ignoredMarketplaceRowsCount:
      ignoredMarketplaceRowsCount
  };
}