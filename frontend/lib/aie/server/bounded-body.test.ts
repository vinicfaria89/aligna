import {
  describe,
  expect,
  it,
} from "vitest";

import {
  readBoundedBytes,
} from "./bounded-body";

/** TASK-024: the shared bounded body reader (bytes, never truncating). */

function request(
  body: BodyInit | null,
  headers: Record<string, string> = {},
): Request {
  return new Request(
    "http://localhost/x",
    {
      method: "POST",

      headers,

      ...(body === null ? {} : { body }),
    },
  );
}

describe("readBoundedBytes", () => {
  it("returns the exact bytes within the limit", async () => {
    const result =
      await readBoundedBytes(
        request("héllo"),
        100,
      );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(
        new TextDecoder().decode(
          result.bytes,
        ),
      ).toBe("héllo");

      // Bytes, not characters: "é" is two bytes.
      expect(
        result.bytes.byteLength,
      ).toBe(6);
    }
  });

  it("accepts a body exactly at the limit and rejects one byte more", async () => {
    expect(
      (
        await readBoundedBytes(
          request("x".repeat(10)),
          10,
        )
      ).ok,
    ).toBe(true);

    expect(
      await readBoundedBytes(
        request("x".repeat(11)),
        10,
      ),
    ).toEqual({
      ok: false,

      reason: "too_large",
    });
  });

  it("counts bytes, not characters, against the limit", async () => {
    expect(
      await readBoundedBytes(
        request("é".repeat(6)),
        10,
      ),
    ).toEqual({
      ok: false,

      reason: "too_large",
    });
  });

  it("rejects a declared Content-Length above the limit without reading the body", async () => {
    const declared = request("small", {
      "content-length": "999",
    });

    expect(
      await readBoundedBytes(
        declared,
        10,
      ),
    ).toEqual({
      ok: false,

      reason: "too_large",
    });

    expect(declared.bodyUsed).toBe(
      false,
    );
  });

  it("treats a missing body as empty", async () => {
    const result =
      await readBoundedBytes(
        request(null),
        10,
      );

    expect(result).toEqual({
      ok: true,

      bytes: new Uint8Array(0),
    });
  });

  it("reports an unreadable stream instead of throwing", async () => {
    const failing = {
      headers: new Headers(),

      body: {
        getReader: () => ({
          read: async () => {
            throw new Error(
              "socket closed",
            );
          },

          cancel: async () =>
            undefined,
        }),
      },
    } as unknown as Request;

    expect(
      await readBoundedBytes(
        failing,
        10,
      ),
    ).toEqual({
      ok: false,

      reason: "unreadable",
    });
  });

  it("never truncates: a rejected body yields no bytes", async () => {
    const result =
      await readBoundedBytes(
        request("x".repeat(50)),
        10,
      );

    expect(result).not.toHaveProperty(
      "bytes",
    );
  });
});
