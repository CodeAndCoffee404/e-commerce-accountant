/**
 * Создаёт меню при открытии таблицы.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Report Automation")
    .addItem(
      "Upload raw report",
      "showUploadDialog"
    )
    .addItem(
      "Generate report",
      "showReportGeneratorDialog"
    )
    .addToUi();
}

/**
 * Открывает веб-интерфейс Generate report.
 */
function showReportGeneratorDialog() {
  const html = HtmlService
    .createHtmlOutputFromFile("UI_ReportGenerator")
    .setWidth(720)
    .setHeight(640);

  SpreadsheetApp.getUi().showModalDialog(
    html,
    "Report generator"
  );
}

/**
 * Открывает веб-интерфейс Upload raw report.
 */
function showUploadDialog() {
  const html = HtmlService
    .createHtmlOutputFromFile("UI_ReportUpload")
    .setWidth(UPLOAD_CONFIG.dialogWidth)
    .setHeight(UPLOAD_CONFIG.dialogHeight);

  SpreadsheetApp.getUi().showModalDialog(
    html,
    "Upload raw report"
  );
}