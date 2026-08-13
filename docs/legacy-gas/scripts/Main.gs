/**
 * Добавляет меню Amazon VAT при открытии Google Sheets.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Amazon VAT')
    .addItem(
      'Загрузить VAT Transaction Report',
      'showAmazonVatUploadDialog'
    )
    .addToUi();
}


/**
 * Открывает окно загрузки CSV.
 */
function showAmazonVatUploadDialog() {
  const html = HtmlService.createHtmlOutput(`
    <!DOCTYPE html>
    <html>
      <head>
        <base target="_top">

        <style>
          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 24px;
            font-family: Arial, sans-serif;
            color: #202124;
          }

          h2 {
            margin: 0 0 8px;
            font-size: 18px;
          }

          .description {
            margin-bottom: 20px;
            color: #5f6368;
            font-size: 13px;
            line-height: 1.4;
          }

          #fileInput {
            display: none;
          }

          .file-row {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 20px;
          }

          button {
            min-height: 38px;
            padding: 9px 16px;
            border: 0;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
          }

          #chooseFileButton {
            background: #f1f3f4;
            color: #202124;
          }

          #uploadButton {
            background: #1a73e8;
            color: #ffffff;
          }

          #uploadButton:disabled,
          #chooseFileButton:disabled {
            cursor: default;
            opacity: 0.6;
          }

          #fileName {
            max-width: 300px;
            overflow: hidden;
            color: #5f6368;
            font-size: 13px;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .sheet-selection {
            margin-bottom: 20px;
            padding: 14px 16px;
            border: 1px solid #dadce0;
            border-radius: 6px;
          }

          .sheet-selection-title {
            margin-bottom: 10px;
            font-size: 13px;
            font-weight: 600;
          }

          .checkbox-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px 20px;
          }

          .checkbox-label {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            font-size: 13px;
          }

          .checkbox-label input {
            width: 16px;
            height: 16px;
            margin: 0;
          }

          .selection-actions {
            display: flex;
            gap: 12px;
            margin-top: 12px;
          }

          .text-button {
            min-height: auto;
            padding: 0;
            border: 0;
            background: transparent;
            color: #1a73e8;
            font-size: 12px;
          }

          #status {
            margin-top: 16px;
            font-size: 13px;
            line-height: 1.5;
            white-space: pre-wrap;
          }

          .error {
            color: #b3261e;
          }

          .success {
            color: #137333;
          }
        </style>
      </head>

      <body>
        <h2>Amazon VAT Transaction Report</h2>

        <div class="description">
          Выберите Amazon VAT Transaction Report в формате CSV
          и отметьте листы, которые нужно создать.
        </div>

        <input
          id="fileInput"
          type="file"
          accept=".csv,text/csv,text/plain"
        >

        <div class="file-row">
          <button id="chooseFileButton" type="button">
            Выбрать файл
          </button>

          <span id="fileName">
            Файл не выбран
          </span>
        </div>

        <div class="sheet-selection">
          <div class="sheet-selection-title">
            Создать листы:
          </div>

          <div class="checkbox-grid">
            <label class="checkbox-label">
              <input
                id="generateRaw"
                type="checkbox"
                checked
              >
              Raw
            </label>

            <label class="checkbox-label">
              <input
                id="generateRegular"
                type="checkbox"
                checked
              >
              Regular
            </label>

            <label class="checkbox-label">
              <input
                id="generateOss"
                type="checkbox"
                checked
              >
              OSS
            </label>

            <label class="checkbox-label">
              <input
                id="generateExceptions"
                type="checkbox"
                checked
              >
              Exceptions
            </label>
          </div>

          <div class="selection-actions">
            <button
              id="selectAllButton"
              class="text-button"
              type="button"
            >
              Выбрать все
            </button>

            <button
              id="clearAllButton"
              class="text-button"
              type="button"
            >
              Снять все
            </button>
          </div>
        </div>

        <button
          id="uploadButton"
          type="button"
          disabled
        >
          Загрузить и обработать
        </button>

        <div id="status"></div>

        <script>
          const fileInput =
            document.getElementById('fileInput');

          const chooseFileButton =
            document.getElementById('chooseFileButton');

          const uploadButton =
            document.getElementById('uploadButton');

          const fileName =
            document.getElementById('fileName');

          const status =
            document.getElementById('status');

          const generateRaw =
            document.getElementById('generateRaw');

          const generateRegular =
            document.getElementById('generateRegular');

          const generateOss =
            document.getElementById('generateOss');

          const generateExceptions =
            document.getElementById(
              'generateExceptions'
            );

          const selectAllButton =
            document.getElementById(
              'selectAllButton'
            );

          const clearAllButton =
            document.getElementById(
              'clearAllButton'
            );

          const sheetCheckboxes = [
            generateRaw,
            generateRegular,
            generateOss,
            generateExceptions
          ];


          chooseFileButton.addEventListener(
            'click',
            function () {
              fileInput.click();
            }
          );


          fileInput.addEventListener(
            'change',
            function () {
              const file = fileInput.files[0];

              status.textContent = '';
              status.className = '';

              if (!file) {
                fileName.textContent =
                  'Файл не выбран';

                updateUploadButtonState();
                return;
              }

              fileName.textContent = file.name;

              if (
                !file.name
                  .toLowerCase()
                  .endsWith('.csv')
              ) {
                status.textContent =
                  'Выберите файл с расширением .csv';

                status.className = 'error';
                updateUploadButtonState();
                return;
              }

              updateUploadButtonState();
            }
          );


          sheetCheckboxes.forEach(
            function (checkbox) {
              checkbox.addEventListener(
                'change',
                updateUploadButtonState
              );
            }
          );


          selectAllButton.addEventListener(
            'click',
            function () {
              sheetCheckboxes.forEach(
                function (checkbox) {
                  checkbox.checked = true;
                }
              );

              updateUploadButtonState();
            }
          );


          clearAllButton.addEventListener(
            'click',
            function () {
              sheetCheckboxes.forEach(
                function (checkbox) {
                  checkbox.checked = false;
                }
              );

              updateUploadButtonState();
            }
          );


          uploadButton.addEventListener(
            'click',
            function () {
              const file = fileInput.files[0];

              if (!file) {
                status.textContent =
                  'Сначала выберите CSV-файл.';

                status.className = 'error';
                return;
              }

              const selectedSheets = {
                raw: generateRaw.checked,
                regular: generateRegular.checked,
                oss: generateOss.checked,
                exceptions:
                  generateExceptions.checked
              };

              const hasSelectedSheets =
                selectedSheets.raw ||
                selectedSheets.regular ||
                selectedSheets.oss ||
                selectedSheets.exceptions;

              if (!hasSelectedSheets) {
                status.textContent =
                  'Выберите хотя бы один лист.';

                status.className = 'error';
                return;
              }

              setControlsDisabled(true);

              status.textContent =
                'Читаю CSV-файл...';

              status.className = '';

              const reader = new FileReader();

              reader.onload = function (event) {
                status.textContent =
                  'Файл прочитан. Создаю выбранные отчёты...';

                google.script.run
                  .withSuccessHandler(
                    function (result) {
                      const lines = [
                        'Готово.',
                        '',
                        'Созданы листы:'
                      ];

                      result.sheetNames.forEach(
                        function (sheetName) {
                          lines.push(
                            '• ' + sheetName
                          );
                        }
                      );

                      if (
                        result.results &&
                        result.results.raw
                      ) {
                        lines.push('');
                        lines.push(
                          'Raw: ' +
                          result.results.raw.rowCount +
                          ' строк.'
                        );
                      }

                      if (
                        result.results &&
                        result.results.regular
                      ) {
                        lines.push(
                          'Regular: ' +
                          result.results.regular.rowCount +
                          ' строк в сводке.'
                        );

                        lines.push(
                          'Строк Regular: ' +
                          result.results.regular
                            .regularSourceRowsCount
                        );

                        lines.push(
                          'Пропущено строк Regular: ' +
                          result.results.regular
                            .skippedRowsCount
                        );
                      }

                      if (
                        result.results &&
                        result.results.oss
                      ) {
                        lines.push(
                          'OSS: ' +
                          result.results.oss.rowCount +
                          ' строк в сводке.'
                        );

                        lines.push(
                          'Строк UNION-OSS: ' +
                          result.results.oss
                            .ossSourceRowsCount
                        );

                        lines.push(
                          'Пропущено строк OSS: ' +
                          result.results.oss
                            .skippedRowsCount
                        );
                      }

                      if (
                        result.results &&
                        result.results.exceptions
                      ) {
                        lines.push(
                          'Exceptions: ' +
                          result.results.exceptions.rowCount +
                          ' строк.'
                        );
                      }

                      status.textContent =
                        lines.join('\\n');

                      status.className = 'success';

                      setControlsDisabled(false);
                      updateUploadButtonState();
                    }
                  )
                  .withFailureHandler(
                    function (error) {
                      const message =
                        error && error.message
                          ? error.message
                          : String(error);

                      status.textContent =
                        'Ошибка Apps Script:\\n' +
                        message;

                      status.className = 'error';

                      setControlsDisabled(false);
                      updateUploadButtonState();
                    }
                  )
                  .processAmazonVatCsv({
                    fileName: file.name,
                    content: event.target.result,
                    selectedSheets: selectedSheets
                  });
              };

              reader.onerror = function () {
                status.textContent =
                  'Браузер не смог прочитать выбранный файл.';

                status.className = 'error';

                setControlsDisabled(false);
                updateUploadButtonState();
              };

              reader.readAsText(file, 'UTF-8');
            }
          );


          /**
           * Проверяет, можно ли запускать обработку.
           */
          function updateUploadButtonState() {
            const file = fileInput.files[0];

            const validFile =
              file &&
              file.name
                .toLowerCase()
                .endsWith('.csv');

            const hasSelectedSheets =
              sheetCheckboxes.some(
                function (checkbox) {
                  return checkbox.checked;
                }
              );

            uploadButton.disabled =
              !validFile ||
              !hasSelectedSheets;
          }


          /**
           * Блокирует или разблокирует элементы UI.
           *
           * @param {boolean} disabled
           */
          function setControlsDisabled(disabled) {
            chooseFileButton.disabled = disabled;
            uploadButton.disabled = disabled;
            fileInput.disabled = disabled;

            sheetCheckboxes.forEach(
              function (checkbox) {
                checkbox.disabled = disabled;
              }
            );

            selectAllButton.disabled = disabled;
            clearAllButton.disabled = disabled;
          }
        </script>
      </body>
    </html>
  `)
    .setWidth(560)
    .setHeight(550);

  SpreadsheetApp.getUi().showModalDialog(
    html,
    'Загрузка Amazon VAT Report'
  );
}


/**
 * Главная серверная функция обработки CSV.
 *
 * Создаёт только листы, выбранные пользователем.
 *
 * @param {Object} fileData
 * @return {Object}
 */
function processAmazonVatCsv(fileData) {
  validateAmazonVatFile_(fileData);

  const selectedSheets =
    normalizeSelectedSheets_(
      fileData.selectedSheets
    );

  if (
    !selectedSheets.raw &&
    !selectedSheets.regular &&
    !selectedSheets.oss &&
    !selectedSheets.exceptions
  ) {
    throw new Error(
      'Не выбран ни один лист для создания.'
    );
  }

  const spreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  const timeZone =
    spreadsheet.getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone() ||
    'Europe/Amsterdam';

  const createdAt = new Date();

  const context = {
    sourceFileName: fileData.fileName,
    createdAt: createdAt,

    sheetDateLabel: Utilities.formatDate(
      createdAt,
      timeZone,
      'yyyy-MM-dd HH-mm-ss'
    ),

    displayDateLabel: Utilities.formatDate(
      createdAt,
      timeZone,
      'dd.MM.yyyy HH:mm:ss'
    )
  };

  console.log(
    'Начало обработки файла: ' +
    fileData.fileName
  );

  const csvData =
    parseAmazonVatCsv_(fileData.content);

  if (csvData.length === 0) {
    throw new Error(
      'В CSV-файле не найдено данных.'
    );
  }

  console.log(
    'CSV разобран. Строк: ' +
    csvData.length +
    ', колонок: ' +
    csvData[0].length
  );

  /*
   * VatDataContext нужен только для:
   * Regular, OSS и Exceptions.
   *
   * Если выбран только Raw, контекст не создаётся.
   */
  let vatContext = null;

  if (
    selectedSheets.regular ||
    selectedSheets.oss ||
    selectedSheets.exceptions
  ) {
    vatContext =
      createVatDataContext_(csvData);

    console.log(
      'VatDataContext создан. Строк: ' +
      vatContext.rows.length
    );
  }

  const sheetNames = [];
  const results = {};

  /*
   * RAW
   */
  if (selectedSheets.raw) {
    results.raw =
      createRawSheet(
        csvData,
        context
      );

    sheetNames.push(
      results.raw.sheetName
    );

    console.log(
      'Raw-лист создан: ' +
      results.raw.sheetName
    );
  }

  /*
   * REGULAR
   */
  if (selectedSheets.regular) {
    results.regular =
      createRegularSheet(
        vatContext,
        context
      );

    sheetNames.push(
      results.regular.sheetName
    );

    console.log(
      'Regular-лист создан: ' +
      results.regular.sheetName
    );
  }

  /*
   * OSS
   */
  if (selectedSheets.oss) {
    results.oss =
      createOssSheet(
        vatContext,
        context
      );

    sheetNames.push(
      results.oss.sheetName
    );

    console.log(
      'OSS-лист создан: ' +
      results.oss.sheetName
    );
  }

  /*
   * EXCEPTIONS
   */
  if (selectedSheets.exceptions) {
    results.exceptions =
      createExceptionsSheet(
        vatContext,
        context
      );

    sheetNames.push(
      results.exceptions.sheetName
    );

    console.log(
      'Exceptions-лист создан: ' +
      results.exceptions.sheetName
    );
  }

  return {
    success: true,

    sourceFileName:
      fileData.fileName,

    selectedSheets:
      selectedSheets,

    sheetNames:
      sheetNames,

    results:
      results
  };
}


/**
 * Нормализует выбор листов.
 *
 * Для обратной совместимости:
 * если selectedSheets не передан,
 * создаются все листы.
 *
 * @param {Object} selectedSheets
 * @return {Object}
 */
function normalizeSelectedSheets_(
  selectedSheets
) {
  if (
    !selectedSheets ||
    typeof selectedSheets !== 'object'
  ) {
    return {
      raw: true,
      regular: true,
      oss: true,
      exceptions: true
    };
  }

  return {
    raw:
      selectedSheets.raw === true,

    regular:
      selectedSheets.regular === true,

    oss:
      selectedSheets.oss === true,

    exceptions:
      selectedSheets.exceptions === true
  };
}


/**
 * Проверяет загруженный файл.
 *
 * @param {Object} fileData
 */
function validateAmazonVatFile_(fileData) {
  if (!fileData) {
    throw new Error(
      'Файл не был передан.'
    );
  }

  if (
    typeof fileData.fileName !== 'string' ||
    fileData.fileName.trim() === ''
  ) {
    throw new Error(
      'Не удалось определить имя файла.'
    );
  }

  if (
    !fileData.fileName
      .toLowerCase()
      .endsWith('.csv')
  ) {
    throw new Error(
      'Нужно загрузить файл формата CSV.'
    );
  }

  if (
    typeof fileData.content !== 'string' ||
    fileData.content.trim() === ''
  ) {
    throw new Error(
      'Загруженный CSV-файл пуст.'
    );
  }
}


/**
 * Разбирает CSV в прямоугольный массив.
 *
 * @param {string} csvContent
 * @return {string[][]}
 */
function parseAmazonVatCsv_(csvContent) {
  const normalizedContent =
    String(csvContent)
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

  const delimiter =
    detectAmazonVatCsvDelimiter_(
      normalizedContent
    );

  let rows;

  try {
    rows = Utilities.parseCsv(
      normalizedContent,
      delimiter
    );
  } catch (error) {
    throw new Error(
      'Не удалось разобрать CSV. ' +
      'Проверьте структуру файла. ' +
      error.message
    );
  }

  rows = rows.filter(function (row) {
    return row.some(function (cell) {
      return String(cell).trim() !== '';
    });
  });

  if (rows.length === 0) {
    return [];
  }

  const maximumColumnCount =
    rows.reduce(
      function (maximum, row) {
        return Math.max(
          maximum,
          row.length
        );
      },
      0
    );

  return rows.map(function (row) {
    const normalizedRow =
      row.slice();

    while (
      normalizedRow.length <
      maximumColumnCount
    ) {
      normalizedRow.push('');
    }

    return normalizedRow;
  });
}


/**
 * Определяет разделитель CSV.
 *
 * @param {string} content
 * @return {string}
 */
function detectAmazonVatCsvDelimiter_(content) {
  const sampleLines = content
    .split('\n')
    .filter(function (line) {
      return line.trim() !== '';
    })
    .slice(0, 5);

  if (sampleLines.length === 0) {
    return ',';
  }

  const candidates = [
    ',',
    ';',
    '\t'
  ];

  let selectedDelimiter = ',';
  let bestScore = -1;

  candidates.forEach(function (delimiter) {
    let totalColumns = 0;
    let validLines = 0;
    let consistentLines = 0;
    let expectedColumnCount = null;

    sampleLines.forEach(function (line) {
      try {
        const parsed =
          Utilities.parseCsv(
            line,
            delimiter
          );

        if (
          parsed.length === 0 ||
          parsed[0].length <= 1
        ) {
          return;
        }

        const columnCount =
          parsed[0].length;

        totalColumns += columnCount;
        validLines++;

        if (
          expectedColumnCount === null
        ) {
          expectedColumnCount =
            columnCount;
        }

        if (
          columnCount ===
          expectedColumnCount
        ) {
          consistentLines++;
        }
      } catch (error) {
        // Неподходящий разделитель.
      }
    });

    const score =
      consistentLines * 10000 +
      validLines * 1000 +
      totalColumns;

    if (score > bestScore) {
      bestScore = score;
      selectedDelimiter = delimiter;
    }
  });

  return selectedDelimiter;
}