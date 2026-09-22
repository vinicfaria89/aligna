/**
 * Limits and the upload-provenance id format shared by the browser UI and the
 * server CSV endpoint (TASK-025).
 *
 * Browser-safe on purpose (pure constants, no I/O): the server modules import
 * these values, so the UI's local checks can never drift from the server's
 * authoritative limits. The server still enforces every one of them.
 */

/** Maximum CSV request body in bytes (512 KiB). Counted in bytes, not characters. */
export const MAX_CSV_UPLOAD_BYTES =
  512 * 1024;

/** Maximum number of portfolio rows (candidates) in one batch resolution. */
export const MAX_PORTFOLIO_ROWS = 100;

/**
 * Format of the OPAQUE upload id (`fileId`) a client may attach to a CSV so its
 * rows get a deterministic candidate id (`portfolio:<fileId>:<row>`). It
 * identifies a candidate row's provenance inside one upload, never a financial
 * asset, and carries no cryptographic or identity semantics.
 */
export const CSV_UPLOAD_FILE_ID_PATTERN =
  /^[A-Za-z0-9._-]{1,64}$/;
