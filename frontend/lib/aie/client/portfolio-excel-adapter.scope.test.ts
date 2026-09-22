import {
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  describe,
  expect,
  it,
} from "vitest";

/**
 * TASK-038 (static, plain node environment -- no DOM needed): the .xlsx
 * adapter is a browser CLIENT module only. It must never reach the AIE
 * server boundary, its providers/policy/resolution layers, or anything
 * Planejador-specific -- the server never learns that an upload originated
 * as a spreadsheet. The reverse must also hold: no `lib/aie/server` file may
 * reach for `read-excel-file` or the Excel adapter either.
 */

const FRONTEND_ROOT = fileURLToPath(
  new URL("../../..", import.meta.url),
);

function listFiles(
  directory: string,
): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(
    directory,
  )) {
    const path = join(
      directory,
      entry,
    );

    if (statSync(path).isDirectory()) {
      files.push(
        ...listFiles(path),
      );
    } else if (
      /\.(ts|tsx)$/.test(path) &&
      !/\.test\.(ts|tsx)$/.test(path)
    ) {
      files.push(path);
    }
  }

  return files;
}

describe("scope guard: the Excel adapter never reaches lib/aie/server or the Planejador", () => {
  it("portfolio-excel-adapter.ts imports nothing from lib/aie/server, providers, policy, resolution or orchestrator", () => {
    const source = readFileSync(
      join(
        FRONTEND_ROOT,
        "lib/aie/client/portfolio-excel-adapter.ts",
      ),
      "utf8",
    );

    for (const forbidden of [
      "lib/aie/server",
      "/providers",
      "/policy",
      "/resolution",
      "/orchestrator",
      "planejador",
      "Planejador",
    ]) {
      expect(source).not.toContain(
        forbidden,
      );
    }
  });

  it("no lib/aie/server file imports read-excel-file or the Excel adapter", () => {
    const files = listFiles(
      join(
        FRONTEND_ROOT,
        "lib/aie/server",
      ),
    );

    for (const file of files) {
      const source = readFileSync(
        file,
        "utf8",
      );

      expect(source).not.toContain(
        "read-excel-file",
      );

      expect(source).not.toContain(
        "portfolio-excel-adapter",
      );
    }
  });
});
