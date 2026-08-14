/**
 * Where a tenant's uploads live in blob storage.
 *
 * The browser proposes the path and the server signs a token for it, so the
 * prefix is the only thing standing between one tenant and another's files.
 * Every path is checked against this before a token is issued and again before
 * the bytes are read — a request naming someone else's object must not be
 * signed, read, or deleted.
 */
export function uploadPrefix(tenantId: string): string {
  return `uploads/${tenantId}/`;
}

export function isOwnUpload(pathname: string, tenantId: string): boolean {
  const prefix = uploadPrefix(tenantId);

  // `..` cannot climb out of a blob key, but a path that merely starts with the
  // prefix by coincidence should not pass either.
  return pathname.startsWith(prefix) && pathname.length > prefix.length;
}

/**
 * A fresh key for every upload, even when the filename repeats.
 *
 * Overwriting would leave an earlier `source_files` row pointing at bytes that
 * are no longer its own, so its preview and its drill-down would quietly show
 * another file's contents.
 */
export function uploadPath(tenantId: string, filename: string, id: string): string {
  const safe = filename
    .replace(/[^\w.\-() ]+/g, "_")
    // A blob key is not a filesystem path, so `..` cannot traverse anywhere —
    // but a key that reads like one invites the assumption that it can.
    .replace(/\.{2,}/g, ".")
    .slice(-120);

  return `${uploadPrefix(tenantId)}${id}-${safe}`;
}
