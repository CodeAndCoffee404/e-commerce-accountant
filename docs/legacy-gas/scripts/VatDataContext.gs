/**
 * Создаёт общий подготовленный контекст CSV.
 *
 * Здесь нет бизнес-логики Regular, OSS или Exceptions.
 * Функция только стандартизирует исходные данные.
 *
 * @param {string[][]} csvData
 * @return {Object}
 */
function createVatDataContext_(csvData) {
  if (
    !Array.isArray(csvData) ||
    csvData.length === 0
  ) {
    throw new Error(
      'VatDataContext: CSV не содержит данных.'
    );
  }

  const originalHeaders =
    csvData[0].slice();

  const normalizedHeaders =
    originalHeaders.map(function (header) {
      return String(header).trim();
    });

  const indexes = {
    reportingScheme:
      normalizedHeaders.indexOf(
        'TAX_REPORTING_SCHEME'
      ),

    salesChannel:
      normalizedHeaders.indexOf(
        'SALES_CHANNEL'
      ),

    transactionType:
      normalizedHeaders.indexOf(
        'TRANSACTION_TYPE'
      ),

    taxCollectionResponsibility:
      normalizedHeaders.indexOf(
        'TAX_COLLECTION_RESPONSIBILITY'
      ),

    sellerVatNumber:
      normalizedHeaders.indexOf(
        'TRANSACTION_SELLER_VAT_NUMBER'
      ),

    taxableJurisdiction:
      normalizedHeaders.indexOf(
        'TAXABLE_JURISDICTION'
      ),

    transactionCurrencyCode:
      normalizedHeaders.indexOf(
        'TRANSACTION_CURRENCY_CODE'
      ),

    amount:
      normalizedHeaders.indexOf(
        'TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL'
      ),

    vatRate:
      normalizedHeaders.indexOf(
        'PRICE_OF_ITEMS_VAT_RATE_PERCENT'
      )
  };

  const requiredColumns = {
    reportingScheme:
      'TAX_REPORTING_SCHEME',

    salesChannel:
      'SALES_CHANNEL',

    transactionType:
      'TRANSACTION_TYPE',

    taxCollectionResponsibility:
      'TAX_COLLECTION_RESPONSIBILITY',

    sellerVatNumber:
      'TRANSACTION_SELLER_VAT_NUMBER',

    taxableJurisdiction:
      'TAXABLE_JURISDICTION',

    transactionCurrencyCode:
      'TRANSACTION_CURRENCY_CODE',

    amount:
      'TOTAL_ACTIVITY_VALUE_AMT_VAT_INCL',

    vatRate:
      'PRICE_OF_ITEMS_VAT_RATE_PERCENT'
  };

  const missingColumns = [];

  Object.keys(requiredColumns).forEach(
    function (key) {
      if (indexes[key] === -1) {
        missingColumns.push(
          requiredColumns[key]
        );
      }
    }
  );

  if (missingColumns.length > 0) {
    throw new Error(
      'VatDataContext: отсутствуют колонки: ' +
      missingColumns.join(', ')
    );
  }

  const rows = [];

  for (
    let rowIndex = 1;
    rowIndex < csvData.length;
    rowIndex++
  ) {
    const sourceRow =
      csvData[rowIndex];

    const rawAmount =
      sourceRow[indexes.amount];

    rows.push({
      sourceRow: sourceRow,

      sourceRowNumber:
        rowIndex + 1,

      reportingScheme:
        normalizeVatText_(
          sourceRow[
            indexes.reportingScheme
          ]
        ),

      salesChannel:
        normalizeVatText_(
          sourceRow[
            indexes.salesChannel
          ]
        ),

      transactionType:
        normalizeVatText_(
          sourceRow[
            indexes.transactionType
          ]
        ),

      taxCollectionResponsibility:
        normalizeVatText_(
          sourceRow[
            indexes
              .taxCollectionResponsibility
          ]
        ),

      sellerVatNumber:
        String(
          sourceRow[
            indexes.sellerVatNumber
          ] || ''
        ).trim(),

      taxableJurisdiction:
        normalizeVatText_(
          sourceRow[
            indexes.taxableJurisdiction
          ]
        ),

      transactionCurrencyCode:
        normalizeVatText_(
          sourceRow[
            indexes.transactionCurrencyCode
          ]
        ),

      rawAmount: rawAmount,

      amountIsEmpty:
        rawAmount === null ||
        rawAmount === undefined ||
        String(rawAmount).trim() === '',

      amount:
        convertVatNumber_(
          rawAmount
        ),

      vatRate:
        convertVatNumber_(
          sourceRow[indexes.vatRate]
        )
    });
  }

  return {
    csvData: csvData,
    originalHeaders: originalHeaders,
    normalizedHeaders: normalizedHeaders,
    indexes: indexes,
    rows: rows
  };
}


/**
 * Нормализует текстовое значение.
 *
 * @param {*} value
 * @return {string}
 */
function normalizeVatText_(value) {
  return String(
    value === null ||
    value === undefined
      ? ''
      : value
  )
    .trim()
    .toUpperCase();
}


/**
 * Преобразует значение в число.
 *
 * Поддерживает:
 * - 123.45
 * - 123,45
 * - 1,234.56
 * - 1.234,56
 * - (123.45)
 *
 * @param {*} value
 * @return {number|null}
 */
function convertVatNumber_(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  if (
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    return value;
  }

  let normalizedValue =
    String(value)
      .trim()
      .replace(/\s/g, '')
      .replace(/\u00A0/g, '');

  if (normalizedValue === '') {
    return null;
  }

  let isNegative = false;

  if (
    normalizedValue.startsWith('(') &&
    normalizedValue.endsWith(')')
  ) {
    isNegative = true;

    normalizedValue =
      normalizedValue.substring(
        1,
        normalizedValue.length - 1
      );
  }

  const lastCommaPosition =
    normalizedValue.lastIndexOf(',');

  const lastDotPosition =
    normalizedValue.lastIndexOf('.');

  if (
    lastCommaPosition !== -1 &&
    lastDotPosition !== -1
  ) {
    if (
      lastCommaPosition >
      lastDotPosition
    ) {
      normalizedValue =
        normalizedValue
          .replace(/\./g, '')
          .replace(',', '.');
    } else {
      normalizedValue =
        normalizedValue.replace(
          /,/g,
          ''
        );
    }
  } else if (
    lastCommaPosition !== -1
  ) {
    normalizedValue =
      normalizedValue.replace(
        ',',
        '.'
      );
  }

  const numericValue =
    Number(normalizedValue);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return isNegative
    ? -Math.abs(numericValue)
    : numericValue;
}