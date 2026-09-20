/**
 * Deterministic OPAQUE upload id for a selected file (TASK-025).
 *
 * The id lets the server derive `portfolio:<fileId>:<row>` for CSV rows that
 * state no `id` (see PortfolioCsvOptions.defaultFileId). It identifies the
 * provenance of candidate ROWS inside this upload: it does NOT identify a
 * financial asset, is not a content hash of the portfolio, and has no
 * cryptographic or identity semantics.
 *
 * Derived only from the file's name, size and last-modified time, so selecting
 * the same file again yields the same id (no randomness, no clock). The name is
 * folded into the hash and never sent as such. The output matches
 * CSV_UPLOAD_FILE_ID_PATTERN (`f` + 16 hex characters).
 *
 * Browser-safe and pure.
 */

export interface UploadFileFingerprint {
  name: string;

  size: number;

  lastModified: number;
}

/** 32-bit FNV-1a with a caller-chosen offset basis. */
function fnv1a(
  text: string,
  seed: number,
): number {
  let hash = seed >>> 0;

  for (
    let i = 0;
    i < text.length;
    i += 1
  ) {
    hash ^= text.charCodeAt(i);

    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function hex8(value: number): string {
  return value
    .toString(16)
    .padStart(8, "0");
}

export function deriveUploadFileId(
  file: UploadFileFingerprint,
): string {
  const material = `${file.name}|${file.size}|${file.lastModified}`;

  // Two independent 32-bit passes: a longer opaque string, not a security property.
  return `f${hex8(
    fnv1a(material, 0x811c9dc5),
  )}${hex8(fnv1a(material, 0x9e3779b9))}`;
}
