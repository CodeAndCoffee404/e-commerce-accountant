/**
 * UploadService.gs
 *
 * CSV:
 * - разбирается самим Apps Script;
 * - Google Sheet создаётся через SpreadsheetApp;
 * - Drive API для CSV не используется.
 *
 * XLS/XLSX:
 * - конвертируются через Advanced Drive Service.
 */

const UPLOAD_CONFIG = Object.freeze({
  spreadsheetId:
    "1BUEIzz0PTPhm1HMKqMAf-I1hItL2ToH-5Qr0HVisGYU",

  databaseSheetName:
    "Raw report database",

  databaseHeaders: Object.freeze([
    "Type",
    "Period",
    "Csv",
    "Google sheet"
  ]),

  undefinedFolderId:
    "102DZYbJEJV7FPobZIy8WpIfqsMOHsU69",

  undefinedFolderName:
    "Undefined",

  maximumFileSizeBytes:
    20 * 1024 * 1024,

  maximumGoogleSheetsCells:
    10000000,

  timestampTimeZone:
    "Europe/Moscow",

  timestampFormat:
    "yyyy.MM.dd HH-mm-ss",

  lockTimeoutMilliseconds:
    30000,

  allowedExtensions: Object.freeze([
    "csv",
    "xls",
    "xlsx"
  ]),

  mimeTypes: Object.freeze({
    csv: "text/csv",

    xls:
      "application/vnd.ms-excel",

    xlsx:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }),

  googleSheetsMimeType:
    "application/vnd.google-apps.spreadsheet",

  dialogWidth: 720,
  dialogHeight: 640,

  csvDelimiters: Object.freeze([
    ",",
    ";",
    "\t",
    "|"
  ])
});








/**
 * Главная функция обработки.
 *
 * @param {Object} payload
 * @return {Object}
 */
function processUploadedFile(payload) {
  let newOriginalFileId = null;
  let newGoogleSheetId = null;

  try {
    ensureCorrectSpreadsheet_();

    const uploadedFile =
      validateUploadPayload_(payload);

    const fileBytes =
      Utilities.base64Decode(
        uploadedFile.base64Data
      );

    if (fileBytes.length === 0) {
      throw new UploadError_(
        "EMPTY_FILE",
        "Файл отклонён: файл пуст."
      );
    }

    if (
      fileBytes.length >
      UPLOAD_CONFIG.maximumFileSizeBytes
    ) {
      throw new UploadError_(
        "FILE_TOO_LARGE",
        "Файл отклонён: максимальный размер файла — 20 МБ."
      );
    }

    const sourceBlob =
      Utilities.newBlob(
        fileBytes,
        uploadedFile.mimeType,
        uploadedFile.originalFileName
      );

    let sourceValues;
    let googleSpreadsheet;

    if (uploadedFile.extension === "csv") {
      sourceValues =
        parseCsvFile_(fileBytes);

      validateValuesSize_(sourceValues);
    } else {
      const converted =
        convertExcelToTemporarySpreadsheet_(
          sourceBlob
        );

      newGoogleSheetId = converted.id;

      googleSpreadsheet =
        openSpreadsheetWithRetry_(
          newGoogleSheetId
        );

      const sheets =
        googleSpreadsheet.getSheets();

      if (sheets.length !== 1) {
        throw new UploadError_(
          "MULTIPLE_SHEETS",
          "Файл отклонён: Excel-файл должен содержать ровно один лист."
        );
      }

      sourceValues =
        readSheetDisplayValues_(
          sheets[0]
        );

      validateValuesSize_(sourceValues);
    }

    const amazonMonthlyDetection =
      detectAmazonMonthlyTransactionReport_(
        sourceValues
      );

    if (
      amazonMonthlyDetection.detected &&
      uploadedFile.extension !== "csv"
    ) {
      throw new UploadError_(
        "AMAZON_MONTHLY_CSV_REQUIRED",
        "Amazon Monthly Transaction report должен быть загружен в формате CSV."
      );
    }

    const classification =
      classifyReport(
        sourceValues,
        uploadedFile.originalFileName
      );

    /**
     * Обычная первая загрузка получает стандартное имя:
     * <Type> - <Period>
     *
     * Для Amazon Monthly Transaction report timestamp
     * добавляется только если в Raw report database уже
     * существует запись с таким же Type + Period.
     *
     * При этом все версии сохраняются отдельными строками.
     */
    const isDuplicateVersion =
      classification.classified &&
      classification.preserveAllVersions
        ? hasExistingDatabaseRecord_(
            classification.type,
            classification.period
          )
        : false;

    const baseName =
      classification.classified
        ? (
            isDuplicateVersion
              ? createVersionedClassifiedBaseName_(
                  classification.type,
                  classification.period
                )
              : createClassifiedBaseName_(
                  classification.type,
                  classification.period
                )
          )
        : createUndefinedBaseName_();

    const originalFileName =
      baseName +
      "." +
      uploadedFile.extension;

    const googleSheetName =
      baseName;

    const destinationFolderId =
      classification.classified
        ? classification.folderId
        : UPLOAD_CONFIG.undefinedFolderId;

    const destinationFolderName =
      classification.classified
        ? classification.type
        : UPLOAD_CONFIG.undefinedFolderName;

    const destinationFolder =
      getAccessibleFolder_(
        destinationFolderId,
        destinationFolderName
      );

    /**
     * Создаём или дорабатываем Google Sheet.
     */
    if (uploadedFile.extension === "csv") {
      const googleSheetValues =
        getValuesForGoogleSheet_(
          sourceValues,
          classification,
          amazonMonthlyDetection
        );

      validateValuesSize_(
        googleSheetValues
      );

      googleSpreadsheet =
        createGoogleSheetFromValues_(
          googleSheetValues,
          googleSheetName
        );

      newGoogleSheetId =
        googleSpreadsheet.getId();

      moveFileToFolder_(
        newGoogleSheetId,
        destinationFolder
      );
    } else {
      const sheet =
        googleSpreadsheet.getSheets()[0];

      writeValuesAsText_(
        sheet,
        sourceValues
      );

      renameAndMoveFile_(
        newGoogleSheetId,
        googleSheetName,
        destinationFolder
      );
    }

    /**
     * Создаём оригинальный файл.
     */
    const originalBlob =
      sourceBlob.copyBlob();

    originalBlob.setName(
      originalFileName
    );

    const originalFile =
      destinationFolder.createFile(
        originalBlob
      );

    newOriginalFileId =
      originalFile.getId();

    const originalFileUrl =
      originalFile.getUrl();

    const googleSheetUrl =
      googleSpreadsheet.getUrl();

    const lock =
      LockService.getScriptLock();

    if (
      !lock.tryLock(
        UPLOAD_CONFIG.lockTimeoutMilliseconds
      )
    ) {
      throw new UploadError_(
        "LOCK_TIMEOUT",
        "Сейчас обрабатывается другой файл. Повторите загрузку."
      );
    }

    let databaseResult;

    try {
      databaseResult =
        upsertDatabaseRecord_({
          type: classification.type,
          period: classification.period,
          classified:
            classification.classified,

          preserveAllVersions:
            Boolean(
              classification
                .preserveAllVersions
            ),

          originalFileName,
          originalFileUrl,

          googleSheetName,
          googleSheetUrl
        });

      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }

    /**
     * Старая версия удаляется только после
     * успешной записи новой версии в базу.
     */
    const cleanupErrors = [];

    if (
      databaseResult.replacedExistingRecord
    ) {
      if (
        databaseResult.oldOriginalFileId &&
        databaseResult.oldOriginalFileId !==
          newOriginalFileId
      ) {
        if (
          !trashFileSafely_(
            databaseResult.oldOriginalFileId
          )
        ) {
          cleanupErrors.push(
            "не удалось переместить старый оригинал в корзину"
          );
        }
      }

      if (
        databaseResult.oldGoogleSheetFileId &&
        databaseResult.oldGoogleSheetFileId !==
          newGoogleSheetId
      ) {
        if (
          !trashFileSafely_(
            databaseResult.oldGoogleSheetFileId
          )
        ) {
          cleanupErrors.push(
            "не удалось переместить старую Google-таблицу в корзину"
          );
        }
      }
    }

    const cleanupWarning =
      cleanupErrors.length > 0
        ? "Новая версия сохранена, но " +
          cleanupErrors.join(" и ") +
          "."
        : null;

    /**
     * Не удалять успешно созданные файлы в catch.
     */
    newOriginalFileId = null;
    newGoogleSheetId = null;

    return {
      success: true,
      status: classification.status,

      type: classification.type,
      period: classification.period,

      originalFileName,
      originalFileUrl,

      googleSheetName,
      googleSheetUrl,

      destinationFolderName,

      databaseRow:
        databaseResult.rowNumber,

      warning:
        classification.warning,

      cleanupWarning
    };
  } catch (error) {
    trashFileSafely_(newOriginalFileId);
    trashFileSafely_(newGoogleSheetId);

    console.error(
      error && error.stack
        ? error.stack
        : error
    );

    return createErrorResponse_(error);
  }
}


/**
 * Проверяет активную таблицу.
 */
function ensureCorrectSpreadsheet_() {
  const spreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new UploadError_(
      "NO_ACTIVE_SPREADSHEET",
      "Не удалось определить активную таблицу."
    );
  }

  if (
    spreadsheet.getId() !==
    UPLOAD_CONFIG.spreadsheetId
  ) {
    throw new UploadError_(
      "WRONG_SPREADSHEET",
      "Скрипт должен запускаться из таблицы VAT report."
    );
  }
}


/**
 * Проверяет payload.
 *
 * @param {Object} payload
 * @return {Object}
 */
function validateUploadPayload_(payload) {
  if (
    !payload ||
    typeof payload !== "object"
  ) {
    throw new UploadError_(
      "FILE_NOT_RECEIVED",
      "Файл не был передан."
    );
  }

  const originalFileName =
    String(payload.fileName || "");

  const extension =
    getFileExtension_(
      originalFileName
    );

  if (
    !UPLOAD_CONFIG.allowedExtensions.includes(
      extension
    )
  ) {
    throw new UploadError_(
      "UNSUPPORTED_EXTENSION",
      "Файл отклонён. Поддерживаются только CSV, XLS и XLSX."
    );
  }

  const fileSize =
    Number(payload.fileSize);

  if (
    !Number.isFinite(fileSize) ||
    fileSize <= 0
  ) {
    throw new UploadError_(
      "EMPTY_FILE",
      "Файл отклонён: файл пуст."
    );
  }

  if (
    fileSize >
    UPLOAD_CONFIG.maximumFileSizeBytes
  ) {
    throw new UploadError_(
      "FILE_TOO_LARGE",
      "Файл отклонён: максимальный размер файла — 20 МБ."
    );
  }

  const base64Data =
    String(payload.base64Data || "");

  if (!base64Data) {
    throw new UploadError_(
      "NO_FILE_DATA",
      "Не удалось получить содержимое файла."
    );
  }

  return {
    originalFileName,
    extension,
    fileSize,
    base64Data,
    mimeType:
      UPLOAD_CONFIG.mimeTypes[extension]
  };
}


/**
 * Разбирает CSV.
 *
 * @param {number[]} fileBytes
 * @return {string[][]}
 */
function parseCsvFile_(fileBytes) {
  const decoded =
    decodeCsvBytes_(fileBytes);

  const delimiterResult =
    detectCsvDelimiter_(decoded);

  if (!delimiterResult) {
    throw new UploadError_(
      "CSV_DELIMITER_NOT_DETECTED",
      "Не удалось определить разделитель CSV."
    );
  }

  let values;

  try {
    values = Utilities.parseCsv(
      decoded,
      delimiterResult.delimiter
    );
  } catch (error) {
    throw new UploadError_(
      "CORRUPTED_CSV",
      "Файл отклонён: CSV не может быть прочитан."
    );
  }

  if (
    !Array.isArray(values) ||
    values.length === 0
  ) {
    throw new UploadError_(
      "EMPTY_CSV",
      "Файл отклонён: CSV не содержит данных."
    );
  }

  /**
   * Удаляем BOM из первого заголовка.
   */
  if (
    values[0] &&
    values[0].length > 0
  ) {
    values[0][0] = String(
      values[0][0]
    ).replace(/^\uFEFF/, "");
  }

  return normalizeRowsWidth_(values);
}


/**
 * Пытается декодировать CSV.
 *
 * @param {number[]} bytes
 * @return {string}
 */
function decodeCsvBytes_(bytes) {
  const blob =
    Utilities.newBlob(bytes);

  const utf8Text =
    blob.getDataAsString("UTF-8");

  /**
   * Если UTF-8 не содержит большого количества
   * replacement characters, используем его.
   */
  const replacementCount =
    (utf8Text.match(/\uFFFD/g) || [])
      .length;

  if (
    replacementCount <=
    Math.max(3, utf8Text.length * 0.0001)
  ) {
    return utf8Text.replace(/^\uFEFF/, "");
  }

  /**
   * Запасной вариант для западноевропейских CSV.
   */
  try {
    return blob
      .getDataAsString("Windows-1252")
      .replace(/^\uFEFF/, "");
  } catch (error) {
    throw new UploadError_(
      "CSV_ENCODING_ERROR",
      "Не удалось определить кодировку CSV."
    );
  }
}


/**
 * Выбирает разделитель по наиболее стабильной структуре.
 *
 * @param {string} csvText
 * @return {{delimiter: string, score: number}|null}
 */
function detectCsvDelimiter_(csvText) {
  let bestResult = null;

  UPLOAD_CONFIG.csvDelimiters.forEach(
    delimiter => {
      try {
        const parsed =
          Utilities.parseCsv(
            csvText,
            delimiter
          );

        const score =
          scoreParsedCsv_(parsed);

        if (
          !bestResult ||
          score > bestResult.score
        ) {
          bestResult = {
            delimiter,
            score
          };
        }
      } catch (error) {
        // Этот разделитель не подходит.
      }
    }
  );

  if (
    !bestResult ||
    bestResult.score <= 1
  ) {
    return null;
  }

  return bestResult;
}


/**
 * Чем больше стабильных колонок, тем выше score.
 *
 * @param {string[][]} parsed
 * @return {number}
 */
function scoreParsedCsv_(parsed) {
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0
  ) {
    return 0;
  }

  const rowWidths = parsed
    .slice(0, 100)
    .filter(row =>
      Array.isArray(row) &&
      row.some(value => value !== "")
    )
    .map(row => row.length);

  if (rowWidths.length === 0) {
    return 0;
  }

  const frequencies = {};

  rowWidths.forEach(width => {
    frequencies[width] =
      (frequencies[width] || 0) + 1;
  });

  let dominantWidth = 0;
  let dominantCount = 0;

  Object.keys(frequencies).forEach(key => {
    const width = Number(key);
    const count = frequencies[key];

    if (
      count > dominantCount ||
      (
        count === dominantCount &&
        width > dominantWidth
      )
    ) {
      dominantWidth = width;
      dominantCount = count;
    }
  });

  if (dominantWidth <= 1) {
    return 0;
  }

  const consistency =
    dominantCount / rowWidths.length;

  return (
    dominantWidth * 1000 +
    consistency * 100
  );
}


/**
 * Делает все строки одинаковой ширины.
 *
 * @param {string[][]} values
 * @return {string[][]}
 */
function normalizeRowsWidth_(values) {
  const maximumWidth = values.reduce(
    (maximum, row) =>
      Math.max(
        maximum,
        Array.isArray(row)
          ? row.length
          : 0
      ),
    0
  );

  return values.map(row => {
    const normalized =
      Array.isArray(row)
        ? row.slice()
        : [];

    while (
      normalized.length <
      maximumWidth
    ) {
      normalized.push("");
    }

    return normalized.map(value =>
      value === null ||
      typeof value === "undefined"
        ? ""
        : String(value)
    );
  });
}


/**
 * Проверяет лимит Google Sheets.
 *
 * @param {string[][]} values
 */
function validateValuesSize_(values) {
  if (
    !Array.isArray(values) ||
    values.length === 0
  ) {
    return;
  }

  const rows = values.length;
  const columns = values[0].length;
  const cells = rows * columns;

  if (
    cells >
    UPLOAD_CONFIG.maximumGoogleSheetsCells
  ) {
    throw new UploadError_(
      "SHEET_TOO_LARGE",
      "Файл отклонён: его невозможно поместить в одну Google-таблицу."
    );
  }
}


/**
 * Возвращает данные, которые должны попасть
 * в создаваемый Google Sheet.
 *
 * Для любого Amazon Monthly Transaction report
 * все служебные строки выше найденного заголовка
 * удаляются.
 */
function getValuesForGoogleSheet_(
  sourceValues,
  classification,
  amazonMonthlyDetection
) {
  const isAmazonMonthly =
    Boolean(
      amazonMonthlyDetection &&
      amazonMonthlyDetection.detected
    ) ||
    Boolean(
      classification &&
      classification
        .isAmazonMonthlyTransaction
    );

  if (isAmazonMonthly) {
    let startRowIndex = -1;

    if (
      classification &&
      Number.isInteger(
        classification.outputStartRowIndex
      )
    ) {
      startRowIndex =
        classification.outputStartRowIndex;
    } else if (
      amazonMonthlyDetection &&
      Number.isInteger(
        amazonMonthlyDetection
          .headerRowIndex
      )
    ) {
      startRowIndex =
        amazonMonthlyDetection
          .headerRowIndex;
    }

    if (startRowIndex < 0) {
      throw new UploadError_(
        "AMAZON_MONTHLY_HEADER_NOT_FOUND",
        "Amazon Monthly Transaction report: строка заголовков не найдена среди первых 20 строк."
      );
    }

    const trimmedValues =
      sourceValues.slice(
        startRowIndex
      );

    if (
      !Array.isArray(trimmedValues) ||
      trimmedValues.length === 0
    ) {
      throw new UploadError_(
        "AMAZON_MONTHLY_NO_DATA",
        "Amazon Monthly Transaction report не содержит данных после найденной строки заголовков."
      );
    }

    return trimmedValues;
  }

  return sourceValues;
}


/**
 * Создаёт Google Sheet из CSV-значений.
 *
 * @param {string[][]} values
 * @param {string} spreadsheetName
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function createGoogleSheetFromValues_(
  values,
  spreadsheetName
) {
  let spreadsheet = null;

  try {
    spreadsheet =
      SpreadsheetApp.create(
        spreadsheetName
      );

    const sheet =
      spreadsheet.getSheets()[0];

    sheet.setName("Raw data");

    writeValuesAsText_(
      sheet,
      values
    );

    return spreadsheet;
  } catch (error) {
    if (spreadsheet) {
      trashFileSafely_(
        spreadsheet.getId()
      );
    }

    throw new UploadError_(
      "CSV_SHEET_CREATION_FAILED",
      "Не удалось создать Google Sheet из CSV."
    );
  }
}


/**
 * Пишет значения как текст.
 *
 * Запись делится на блоки, чтобы обрабатывать
 * отчёты примерно до 20 000 строк.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[][]} values
 */
function writeValuesAsText_(sheet, values) {
  if (
    !Array.isArray(values) ||
    values.length === 0
  ) {
    return;
  }

  const rowCount = values.length;
  const columnCount =
    values[0].length;

  if (columnCount === 0) {
    return;
  }

  ensureSheetSize_(
    sheet,
    rowCount,
    columnCount
  );

  const batchSize = 2000;

  for (
    let startRow = 0;
    startRow < rowCount;
    startRow += batchSize
  ) {
    const batch =
      values.slice(
        startRow,
        startRow + batchSize
      );

    const range = sheet.getRange(
      startRow + 1,
      1,
      batch.length,
      columnCount
    );

    range.setNumberFormat("@");
    range.setValues(batch);
  }

  SpreadsheetApp.flush();
}


/**
 * Увеличивает размеры листа при необходимости.
 */
function ensureSheetSize_(
  sheet,
  requiredRows,
  requiredColumns
) {
  const currentRows =
    sheet.getMaxRows();

  const currentColumns =
    sheet.getMaxColumns();

  if (currentRows < requiredRows) {
    sheet.insertRowsAfter(
      currentRows,
      requiredRows - currentRows
    );
  }

  if (
    currentColumns <
    requiredColumns
  ) {
    sheet.insertColumnsAfter(
      currentColumns,
      requiredColumns -
        currentColumns
    );
  }
}


/**
 * Конвертирует Excel во временный Google Sheet.
 *
 * Требуется Advanced Drive Service.
 *
 * @param {Blob} blob
 * @return {Object}
 */
function convertExcelToTemporarySpreadsheet_(
  blob
) {
  const temporaryName =
    "temporary-report-" +
    Utilities.getUuid();

  try {
    return Drive.Files.create(
      {
        name: temporaryName,

        mimeType:
          UPLOAD_CONFIG.googleSheetsMimeType,

        parents: [
          UPLOAD_CONFIG.undefinedFolderId
        ]
      },
      blob,
      {
        fields:
          "id,name,mimeType,parents,webViewLink"
      }
    );
  } catch (error) {
    const message =
      getErrorText_(error);

    console.error(
      "Excel conversion error:",
      message
    );

    if (
      /Drive is not defined/i.test(message)
    ) {
      throw new UploadError_(
        "DRIVE_SERVICE_NOT_ENABLED",
        "Для обработки XLS/XLSX включите Advanced Drive Service."
      );
    }

    if (
      /permission|forbidden|access denied|insufficient/i.test(
        message
      )
    ) {
      throw new UploadError_(
        "DRIVE_ACCESS_DENIED",
        "Не удалось конвертировать Excel. Проверьте доступ к папке Undefined."
      );
    }

    if (
      /password|encrypted|protected/i.test(
        message
      )
    ) {
      throw new UploadError_(
        "PASSWORD_PROTECTED",
        "Файл отклонён: защищённые паролем файлы не поддерживаются."
      );
    }

    throw new UploadError_(
      "EXCEL_CONVERSION_FAILED",
      "Google Drive не смог преобразовать XLS/XLSX в Google Sheets."
    );
  }
}


/**
 * Открывает конвертированный Excel.
 */
function openSpreadsheetWithRetry_(
  spreadsheetId
) {
  const attempts = 6;
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= attempts;
    attempt += 1
  ) {
    try {
      return SpreadsheetApp.openById(
        spreadsheetId
      );
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        Utilities.sleep(
          attempt * 700
        );
      }
    }
  }

  throw new UploadError_(
    "SPREADSHEET_OPEN_FAILED",
    "Файл был конвертирован, но Google Sheet не удалось открыть."
  );
}


/**
 * Читает отображаемые значения Excel.
 */
function readSheetDisplayValues_(sheet) {
  const rows =
    sheet.getLastRow();

  const columns =
    sheet.getLastColumn();

  if (
    rows === 0 ||
    columns === 0
  ) {
    return [];
  }

  return sheet
    .getRange(
      1,
      1,
      rows,
      columns
    )
    .getDisplayValues();
}


/**
 * Проверяет папку.
 */
function getAccessibleFolder_(folderId, folderName) {
  try {
    const folder = DriveApp.getFolderById(folderId);
    const actualFolderName = folder.getName();

    console.log(
      JSON.stringify({
        event: "FOLDER_ACCESS_SUCCESS",
        expectedFolderName: folderName,
        actualFolderName: actualFolderName,
        folderId: folderId,
        folderUrl: folder.getUrl()
      })
    );

    return folder;
  } catch (error) {
    const technicalMessage = getErrorText_(error);

    console.error(
      JSON.stringify({
        event: "FOLDER_ACCESS_FAILED",
        folderName: folderName,
        folderId: folderId,
        errorName: error && error.name
          ? error.name
          : null,
        errorMessage: technicalMessage,
        errorStack: error && error.stack
          ? error.stack
          : null
      })
    );

    if (
      /authorization is required/i.test(technicalMessage) ||
      /not authorized/i.test(technicalMessage) ||
      /missing required scope/i.test(technicalMessage) ||
      /insufficient authentication scopes/i.test(technicalMessage)
    ) {
      throw new UploadError_(
        "DRIVE_AUTHORIZATION_REQUIRED",
        "Apps Script не получил разрешение на работу с Google Drive. " +
        "Запустите функцию authorizeReportAutomation из редактора Apps Script " +
        "и подтвердите доступ."
      );
    }

    if (
      /unexpected error while getting the method or property getFolderById/i.test(
        technicalMessage
      )
    ) {
      throw new UploadError_(
        "DRIVE_SERVICE_ERROR",
        "DriveApp не смог открыть папку. Причина Google: " +
        technicalMessage
      );
    }

    if (
      /does not exist/i.test(technicalMessage) ||
      /not found/i.test(technicalMessage) ||
      /invalid argument/i.test(technicalMessage)
    ) {
      throw new UploadError_(
        "FOLDER_NOT_FOUND",
        "Google Drive не нашёл папку " +
        folderName +
        ". Проверьте ID папки: " +
        folderId +
        ". Причина Google: " +
        technicalMessage
      );
    }

    throw new UploadError_(
      "FOLDER_ACCESS_FAILED",
      "Не удалось открыть папку " +
        folderName +
        ". Причина Google: " +
        technicalMessage
    );
  }
}

function authorizeReportAutomation() {
  // Принудительно вызывает Advanced Drive Service
  // и требует полный scope Google Drive.
  const file = Drive.Files.get(
    UPLOAD_CONFIG.spreadsheetId,
    {
      fields: "id,name,parents"
    }
  );

  const folders = [
    {
      name:
        "Amazon VAT transaction report",
      id:
        "1PHothmoaIfKXB4HKb2ipi1T4KVscknfL"
    },
    {
      name:
        "Allegro sales report",
      id:
        "1mY8y5zs5qZDrUJGqcjNgr_YOervdLreA"
    },
    {
      name:
        "Cdiscount sales report",
      id:
        "1OzTskRUy8jO1429gWMGDO3pCQ2eCKtgi"
    },
    {
      name:
        "Geyser shopify sales report",
      id:
        "12H_qu23GTMQgN_9osLoH9ILb7LSKy_Q-"
    },
    {
      name:
        "Amazon Monthly Transaction report ES",
      id:
        "19Hs6Lr32uNu1earnBmkwjt0RCNJXp4ow"
    },
    {
      name:
        "Amazon Monthly Transaction report IT",
      id:
        "1XG3eX1R1F3FlvUu6ocgh-ErC6m9RIq6i"
    },
    {
      name:
        "Amazon Monthly Transaction report FR",
      id:
        "1KOdn-hNWoj_zgPwiSl4skCICEJzqHWQ7"
    },
    {
      name:
        "Amazon Monthly Transaction report DE",
      id:
        "1o5JbrKU1oPHE4Xg9C-JgxKvpjgSEtD9S"
    },
    {
      name:
        "Amazon Monthly Transaction report UK",
      id:
        "1vPXN0znaOOC5WpdAXx4Ev14M7pg4FpjD"
    },
    {
      name:
        "Amazon Monthly Transaction report SE",
      id:
        "1N9pQk2CU_GxT-J3PyfUmuHTW-Gg3X04m"
    },
    {
      name:
        "Amazon Monthly Transaction report PL",
      id:
        "1928co5tZ90FSkcZTtbD_7Ibw5zJm0qV4"
    },
    {
      name:
        "Amazon Monthly Transaction report NL",
      id:
        "1pw5JpKMEBaeIpMr8njMiv1xtKK6HESLt"
    },
    {
      name:
        "Amazon Monthly Transaction report IE",
      id:
        "1zyr89zk0k5XNPvLkIYQA9u9TOZvsEBSV"
    },
    {
      name:
        "Amazon Monthly Transaction report BE",
      id:
        "14VlU1cAXo3WY7r2W5ffpIdFuWQPIpvhB"
    },
    {
      name:
        "Undefined",
      id:
        "102DZYbJEJV7FPobZIy8WpIfqsMOHsU69"
    }
  ];

  const results = folders.map(function (item) {
    const folder = DriveApp.getFolderById(item.id);

    return {
      expectedName: item.name,
      actualName: folder.getName(),
      id: item.id,
      url: folder.getUrl()
    };
  });

  console.log(
    JSON.stringify(
      {
        advancedDriveFile: file,
        folders: results
      },
      null,
      2
    )
  );

  SpreadsheetApp.getUi().alert(
    "Авторизация успешно завершена"
  );
}



/**
 * Перемещает файл в папку через Advanced Drive Service.
 *
 * Работает и для My Drive, и для Shared Drive.
 *
 * @param {string} fileId
 * @param {GoogleAppsScript.Drive.Folder} destinationFolder
 */
function moveFileToFolder_(fileId, destinationFolder) {
  const destinationFolderId =
    destinationFolder.getId();

  try {
    const fileMetadata = Drive.Files.get(
      fileId,
      {
        fields: "id,name,parents,driveId",
        supportsAllDrives: true
      }
    );

    const currentParents = Array.isArray(
      fileMetadata.parents
    )
      ? fileMetadata.parents
      : [];

    const parentsToRemove = currentParents
      .filter(function (parentId) {
        return parentId !== destinationFolderId;
      })
      .join(",");

    const parameters = {
      addParents: destinationFolderId,
      fields: "id,name,parents,webViewLink",
      supportsAllDrives: true
    };

    if (parentsToRemove) {
      parameters.removeParents =
        parentsToRemove;
    }

    Drive.Files.update(
      {},
        fileId,
        null,
        parameters
    );
  } catch (error) {
    const technicalMessage =
      getErrorText_(error);

    console.error(
      JSON.stringify({
        event: "FILE_MOVE_FAILED",
        fileId: fileId,
        destinationFolderId:
          destinationFolderId,
        error: technicalMessage,
        stack:
          error && error.stack
            ? error.stack
            : null
      })
    );

    throw new UploadError_(
      "FILE_MOVE_FAILED",
      "Не удалось переместить Google Sheet в папку назначения. " +
      "Причина Google: " +
      technicalMessage
    );
  }
}


/**
 * Переименовывает и перемещает файл
 * через Advanced Drive Service.
 *
 * @param {string} fileId
 * @param {string} name
 * @param {GoogleAppsScript.Drive.Folder} destinationFolder
 */
function renameAndMoveFile_(
  fileId,
  name,
  destinationFolder
) {
  const destinationFolderId =
    destinationFolder.getId();

  try {
    const fileMetadata = Drive.Files.get(
      fileId,
      {
        fields: "id,name,parents,driveId",
        supportsAllDrives: true
      }
    );

    const currentParents = Array.isArray(
      fileMetadata.parents
    )
      ? fileMetadata.parents
      : [];

    const parentsToRemove = currentParents
      .filter(function (parentId) {
        return parentId !== destinationFolderId;
      })
      .join(",");

    const parameters = {
      addParents: destinationFolderId,
      fields: "id,name,parents,webViewLink",
      supportsAllDrives: true
    };

    if (parentsToRemove) {
      parameters.removeParents =
        parentsToRemove;
    }

    Drive.Files.update(
      {
        name: name
      },
      fileId,
      null,
      parameters
    );
  } catch (error) {
    const technicalMessage =
      getErrorText_(error);

    console.error(
      JSON.stringify({
        event: "FILE_RENAME_MOVE_FAILED",
        fileId: fileId,
        newName: name,
        destinationFolderId:
          destinationFolderId,
        error: technicalMessage,
        stack:
          error && error.stack
            ? error.stack
            : null
      })
    );

    throw new UploadError_(
      "FILE_MOVE_FAILED",
      "Не удалось переименовать или переместить Google Sheet. " +
      "Причина Google: " +
      technicalMessage
    );
  }
}


/**
 * Проверяет, существует ли уже запись
 * с таким же Type + Period в Raw report database.
 *
 * Используется только для определения имени новой версии
 * Amazon Monthly Transaction report:
 * - первая версия без timestamp;
 * - следующие версии с timestamp.
 *
 * @param {string} type
 * @param {string} period
 * @return {boolean}
 */
function hasExistingDatabaseRecord_(
  type,
  period
) {
  const spreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  const sheet =
    spreadsheet.getSheetByName(
      UPLOAD_CONFIG.databaseSheetName
    );

  if (!sheet) {
    throw new UploadError_(
      "DATABASE_SHEET_NOT_FOUND",
      "Лист Raw report database не найден."
    );
  }

  validateDatabaseHeaders_(sheet);

  return Boolean(
    findExistingRecord_(
      sheet,
      type,
      period
    )
  );
}


/**
 * Записывает строку в Raw report database.
 */
function upsertDatabaseRecord_(record) {
  const spreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  const sheet =
    spreadsheet.getSheetByName(
      UPLOAD_CONFIG.databaseSheetName
    );

  if (!sheet) {
    throw new UploadError_(
      "DATABASE_SHEET_NOT_FOUND",
      "Лист Raw report database не найден."
    );
  }

  validateDatabaseHeaders_(sheet);

  let targetRow = null;
  let replacedExistingRecord = false;
  let oldOriginalFileId = null;
  let oldGoogleSheetFileId = null;

  if (
    record.classified &&
    !record.preserveAllVersions
  ) {
    const existing =
      findExistingRecord_(
        sheet,
        record.type,
        record.period
      );

    if (existing) {
      targetRow =
        existing.rowNumber;

      replacedExistingRecord = true;

      oldOriginalFileId =
        getLinkedFileIdFromCell_(
          sheet.getRange(
            targetRow,
            3
          )
        );

      oldGoogleSheetFileId =
        getLinkedFileIdFromCell_(
          sheet.getRange(
            targetRow,
            4
          )
        );
    }
  }

  if (!targetRow) {
    targetRow =
      Math.max(
        sheet.getLastRow() + 1,
        2
      );
  }

  sheet
    .getRange(
      targetRow,
      1,
      1,
      2
    )
    .setValues([
      [
        record.type,
        record.period
      ]
    ]);

  setRichTextLink_(
    sheet.getRange(targetRow, 3),
    record.originalFileName,
    record.originalFileUrl
  );

  setRichTextLink_(
    sheet.getRange(targetRow, 4),
    record.googleSheetName,
    record.googleSheetUrl
  );

  return {
    rowNumber: targetRow,
    replacedExistingRecord,
    oldOriginalFileId,
    oldGoogleSheetFileId
  };
}


/**
 * Проверяет заголовки базы.
 */
function validateDatabaseHeaders_(sheet) {
  const actualHeaders =
    sheet
      .getRange(1, 1, 1, 4)
      .getDisplayValues()[0];

  const valid =
    UPLOAD_CONFIG.databaseHeaders.every(
      (header, index) =>
        actualHeaders[index] === header
    );

  if (!valid) {
    throw new UploadError_(
      "DATABASE_STRUCTURE_CHANGED",
      "Ожидаются колонки Type, Period, Csv и Google sheet."
    );
  }
}


/**
 * Ищет Type + Period без учёта регистра.
 */
function findExistingRecord_(
  sheet,
  type,
  period
) {
  const lastRow =
    sheet.getLastRow();

  if (lastRow < 2) {
    return null;
  }

  const values =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        2
      )
      .getDisplayValues();

  const expectedType =
    String(type).toLowerCase();

  const expectedPeriod =
    String(period).toLowerCase();

  for (
    let index = 0;
    index < values.length;
    index += 1
  ) {
    if (
      String(values[index][0])
        .toLowerCase() ===
        expectedType &&
      String(values[index][1])
        .toLowerCase() ===
        expectedPeriod
    ) {
      return {
        rowNumber:
          index + 2
      };
    }
  }

  return null;
}


/**
 * Создаёт кликабельное имя.
 */
function setRichTextLink_(
  cell,
  text,
  url
) {
  const richText =
    SpreadsheetApp
      .newRichTextValue()
      .setText(String(text))
      .setLinkUrl(String(url))
      .build();

  cell.setRichTextValue(
    richText
  );
}


/**
 * Извлекает ID из ссылки.
 */
function getLinkedFileIdFromCell_(cell) {
  try {
    const richText =
      cell.getRichTextValue();

    if (richText) {
      const directUrl =
        richText.getLinkUrl();

      if (directUrl) {
        const id =
          extractGoogleFileId_(
            directUrl
          );

        if (id) {
          return id;
        }
      }

      const runs =
        richText.getRuns();

      for (
        let index = 0;
        index < runs.length;
        index += 1
      ) {
        const url =
          runs[index].getLinkUrl();

        if (!url) {
          continue;
        }

        const id =
          extractGoogleFileId_(url);

        if (id) {
          return id;
        }
      }
    }

    return extractGoogleFileId_(
      cell.getDisplayValue()
    );
  } catch (error) {
    return null;
  }
}


/**
 * Извлекает Drive ID.
 */
function extractGoogleFileId_(value) {
  const text =
    String(value || "");

  const patterns = [
    /\/d\/([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
    /\b([a-zA-Z0-9_-]{25,})\b/
  ];

  for (
    let index = 0;
    index < patterns.length;
    index += 1
  ) {
    const match =
      text.match(patterns[index]);

    if (match) {
      return match[1];
    }
  }

  return null;
}


/**
 * Формирует уникальное имя версии классифицированного файла.
 *
 * Используется для Amazon Monthly Transaction report
 * только со второй версии одного Type + Period.
 */
function createVersionedClassifiedBaseName_(
  type,
  period
) {
  const timestamp =
    Utilities.formatDate(
      new Date(),
      UPLOAD_CONFIG.timestampTimeZone,
      UPLOAD_CONFIG.timestampFormat
    );

  return sanitizeFileName_(
    type +
      " - " +
      period +
      " - " +
      timestamp
  );
}


/**
 * Формирует имя классифицированного файла.
 */
function createClassifiedBaseName_(
  type,
  period
) {
  return sanitizeFileName_(
    type + " - " + period
  );
}


/**
 * Формирует имя undefined.
 */
function createUndefinedBaseName_() {
  const timestamp =
    Utilities.formatDate(
      new Date(),
      UPLOAD_CONFIG.timestampTimeZone,
      UPLOAD_CONFIG.timestampFormat
    );

  return (
    "undefined - " +
    timestamp
  );
}


/**
 * Удаляет недопустимые символы.
 */
function sanitizeFileName_(value) {
  return String(value)
    .replace(
      /[\\/:*?"<>|]/g,
      "-"
    )
    .replace(/\s+/g, " ")
    .trim();
}


/**
 * Получает расширение.
 */
function getFileExtension_(fileName) {
  const match =
    String(fileName)
      .toLowerCase()
      .match(/\.([^.]+)$/);

  return match
    ? match[1]
    : "";
}


/**
 * Перемещает файл в корзину.
 */
function trashFileSafely_(fileId) {
  if (!fileId) {
    return true;
  }

  try {
    DriveApp
      .getFileById(fileId)
      .setTrashed(true);

    return true;
  } catch (error) {
    console.error(
      "Не удалось отправить файл в корзину:",
      fileId,
      error
    );

    return false;
  }
}


/**
 * Преобразует ошибку в ответ HTML.
 */
function createErrorResponse_(error) {
  if (error instanceof UploadError_) {
    return {
      success: false,
      status: "rejected",
      errorCode: error.code,
      message: error.message
    };
  }

  const technicalMessage =
    getErrorText_(error);

  console.error(
    "Unexpected upload error:",
    technicalMessage
  );

  if (
    /permission|forbidden|access denied|insufficient/i.test(
      technicalMessage
    )
  ) {
    return {
      success: false,
      status: "rejected",
      errorCode: "ACCESS_DENIED",

      message:
        "Недостаточно прав. Проверьте доступ к таблице VAT report и папкам Report Automation."
    };
  }

  return {
    success: false,
    status: "rejected",
    errorCode: "UNEXPECTED_ERROR",

    message:
      "Не удалось обработать файл. Подробная причина записана в журнал выполнения Apps Script."
  };
}


/**
 * Получает текст ошибки.
 */
function getErrorText_(error) {
  if (!error) {
    return "";
  }

  if (error.message) {
    return String(
      error.message
    );
  }

  return String(error);
}


/**
 * Пользовательская ошибка.
 */
function UploadError_(code, message) {
  this.name = "UploadError";
  this.code = code;
  this.message = message;

  if (Error.captureStackTrace) {
    Error.captureStackTrace(
      this,
      UploadError_
    );
  }
}

UploadError_.prototype =
  Object.create(Error.prototype);

UploadError_.prototype.constructor =
  UploadError_;