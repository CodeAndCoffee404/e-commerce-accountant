/** Plan §5, stage 1: files are allowed up to 20 MB. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Browsers disagree about spreadsheet media types — Safari sends
 * `application/octet-stream` for the same .xlsx that Chrome labels properly —
 * so the list is permissive here and the real check is the file's own bytes,
 * done when it is parsed.
 */
export const UPLOAD_CONTENT_TYPES = [
  "text/csv",
  "application/csv",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
] as const;

export const UPLOAD_ACCEPT = ".csv,.xlsx";
