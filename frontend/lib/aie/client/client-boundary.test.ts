import {
  existsSync,
  readFileSync,
} from "node:fs";

import {
  dirname,
  join,
  relative,
  resolve,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  describeIssue,
  describeIssues,
} from "./csv-issue-messages";

/**
 * TASK-025 static guards: the browser UI stays a thin client. It never reaches
 * server-only code, providers, ANBIMA or the verification policy, never reads the
 * environment and never touches browser storage or the console.
 */

const FRONTEND_ROOT = fileURLToPath(
  new URL("../../..", import.meta.url),
);

const CLIENT_FILES = [
  "components/PortfolioCsvResolver.tsx",
  "app/carteira/page.tsx",
  "lib/aie/client/csv-issue-messages.ts",
  "lib/aie/client/portfolio-csv-preview.ts",
  "lib/aie/client/resolve-csv-client.ts",
  "lib/aie/client/upload-file-id.ts",
  "lib/aie/ingestion/portfolio-csv-limits.ts",
];

function code(file: string): string {
  return readFileSync(
    join(FRONTEND_ROOT, file),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function specifiers(
  file: string,
): string[] {
  return [
    ...readFileSync(
      join(FRONTEND_ROOT, file),
      "utf8",
    ).matchAll(
      /from\s*["']([^"']+)["']/g,
    ),
  ].map((match) => match[1] as string);
}

/** Every file reachable from the UI entry points through relative or "@/" imports. */
function reachable(
  entries: string[],
): Set<string> {
  const seen = new Set<string>();

  const queue = entries.map((entry) =>
    join(FRONTEND_ROOT, entry),
  );

  while (queue.length > 0) {
    const file = queue.pop() as string;

    if (seen.has(file)) continue;

    seen.add(file);

    for (const specifier of specifiers(
      relative(FRONTEND_ROOT, file).replace(
        /\\/g,
        "/",
      ),
    )) {
      let base: string | null = null;

      if (specifier.startsWith("@/")) {
        base = join(
          FRONTEND_ROOT,
          specifier.slice(2),
        );
      } else if (specifier.startsWith(".")) {
        base = resolve(
          dirname(file),
          specifier,
        );
      }

      if (base === null) continue;

      for (const candidate of [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
      ]) {
        if (
          existsSync(candidate) &&
          /\.(ts|tsx)$/.test(candidate)
        ) {
          queue.push(candidate);

          break;
        }
      }
    }
  }

  return seen;
}

describe("the CSV resolution UI is a thin, browser-safe client", () => {
  it("reads no environment and touches no browser storage, console or analytics", () => {
    for (const file of CLIENT_FILES) {
      const source = code(file);

      for (const forbidden of [
        "process.env",
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "document.cookie",
        "console.",
        "sendBeacon",
        "gtag(",
      ]) {
        expect(
          source,
        ).not.toContain(forbidden);
      }
    }
  });

  it("names no provider, ANBIMA client, credential or verification policy", () => {
    for (const file of CLIENT_FILES) {
      const source = code(file);

      for (const forbidden of [
        "Anbima",
        "ANBIMA_",
        "VerificationPolicy",
        "ProviderExecutionPipeline",
        "EvidenceOrchestrator",
        "ResolutionPlanner",
        "createAie",
        "clientSecret",
        "access_token",
      ]) {
        expect(
          source,
        ).not.toContain(forbidden);
      }
    }
  });

  it("imports nothing from the server boundary, providers, policy or infrastructure, anywhere in its import graph", () => {
    const files = reachable([
      "components/PortfolioCsvResolver.tsx",
    ]);

    const offenders = [...files]
      .map((file) =>
        relative(
          FRONTEND_ROOT,
          file,
        ).replace(/\\/g, "/"),
      )
      .filter((file) =>
        // The only planner file reachable is the pure TYPE contract that the result
        // contracts refer to (import type, erased at build time).
        (/^lib\/aie\/(server|providers|policy|orchestrator|infrastructure|resolution|application|planner)\//.test(
          file,
        ) &&
          file !==
            "lib/aie/planner/resolution-plan.ts"),
      );

    expect(offenders).toEqual([]);

    // Sanity: the graph is not vacuous and does include the shared adapter.
    expect(files.size).toBeGreaterThan(5);

    expect(
      [...files].some((file) =>
        file
          .replace(/\\/g, "/")
          .endsWith(
            "ingestion/adapters/portfolio-csv-adapter.ts",
          ),
      ),
    ).toBe(true);
  });

  it("reuses the existing CSV adapter and contains no CSV parser or serializer of its own", () => {
    const preview = code(
      "lib/aie/client/portfolio-csv-preview.ts",
    );

    expect(preview).toContain(
      "ingestPortfolioCsv",
    );

    for (const file of CLIENT_FILES) {
      const source = code(file);

      expect(source).not.toContain(
        'split(",")',
      );

      expect(source).not.toContain(
        "split(',')",
      );

      expect(source).not.toMatch(
        /\.join\(\s*["'],["']\s*\)/,
      );
    }
  });

  it("uses the app's existing session for the bearer and no second auth client", () => {
    const component = code(
      "components/PortfolioCsvResolver.tsx",
    );

    expect(component).toContain(
      "getValidAccessToken",
    );

    expect(
      specifiers(
        "components/PortfolioCsvResolver.tsx",
      ),
    ).toContain("@/lib/session");

    // The token is only ever placed in the Authorization header of the client.
    const client = code(
      "lib/aie/client/resolve-csv-client.ts",
    );

    expect(
      client.match(/Bearer \$\{/g),
    ).toHaveLength(1);
  });

  it("marks the component as a client component and the page as a server page", () => {
    expect(
      readFileSync(
        join(
          FRONTEND_ROOT,
          "components/PortfolioCsvResolver.tsx",
        ),
        "utf8",
      ),
    ).toMatch(/^"use client";/);

    expect(
      readFileSync(
        join(
          FRONTEND_ROOT,
          "app/carteira/page.tsx",
        ),
        "utf8",
      ),
    ).not.toMatch(/^"use client"/);
  });
});

describe("issue messages", () => {
  it("describes safe locations and codes in pt-BR and never a value", () => {
    expect(
      describeIssue({
        path: "header[3]",

        code: "forbidden_field",
      }),
    ).toBe(
      "Cabeçalho, coluna 3: coluna não permitida (dados pessoais ou credenciais).",
    );

    expect(
      describeIssue({
        path: "row[4].amount",

        code: "invalid_value",
      }),
    ).toBe(
      "Linha 4, campo amount: valor inválido.",
    );

    expect(
      describeIssue({
        path: "rows",

        code: "too_long",
      }),
    ).toBe(
      "Quantidade de linhas: valor longo demais.",
    );
  });

  it("drops a location or field name it does not recognize instead of echoing it", () => {
    const text = describeIssue({
      path: "row[2].SECRET-COLUMN",

      code: "made_up_code",
    });

    expect(text).not.toContain("SECRET");

    expect(text).not.toContain("made_up");

    expect(
      describeIssue({
        path: "SECRET-PATH",

        code: "invalid_value",
      }),
    ).not.toContain("SECRET");
  });

  it("limits the number of shown issues", () => {
    expect(
      describeIssues(
        Array.from(
          { length: 20 },
          (_, i) => ({
            path: `row[${i + 2}]`,

            code: "invalid_value",
          }),
        ),
      ),
    ).toHaveLength(5);
  });
});
