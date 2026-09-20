/**
 * SERVER-ONLY bounded request-body reader shared by the AIE HTTP mappings
 * (TASK-016 JSON batch, TASK-024 CSV upload).
 *
 * The body is read as BYTES and never held beyond the limit (+ one chunk): a
 * declared `Content-Length` above the limit is rejected before reading, and the
 * stream is cancelled as soon as it exceeds the limit. Bytes are counted, not
 * characters. Nothing is truncated; decoding is left to the caller.
 */

export type BoundedBodyResult =
  | {
      ok: true;

      bytes: Uint8Array;
    }
  | {
      ok: false;

      reason:
        | "too_large"
        | "unreadable";
    };

export async function readBoundedBytes(
  request: Request,
  maxBytes: number,
): Promise<BoundedBodyResult> {
  const declared = Number(
    request.headers.get(
      "content-length",
    ),
  );

  if (
    Number.isFinite(declared) &&
    declared > maxBytes
  ) {
    return {
      ok: false,

      reason: "too_large",
    };
  }

  const stream = request.body;

  if (stream === null) {
    return {
      ok: true,

      bytes: new Uint8Array(0),
    };
  }

  const reader = stream.getReader();

  const chunks: Uint8Array[] = [];

  let total = 0;

  try {
    for (;;) {
      const { done, value } =
        await reader.read();

      if (done) {
        break;
      }

      total += value.byteLength;

      if (total > maxBytes) {
        await reader
          .cancel()
          .catch(() => undefined);

        return {
          ok: false,

          reason: "too_large",
        };
      }

      chunks.push(value);
    }
  } catch {
    return {
      ok: false,

      reason: "unreadable",
    };
  }

  const bytes = new Uint8Array(total);

  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);

    offset += chunk.byteLength;
  }

  return {
    ok: true,

    bytes,
  };
}
