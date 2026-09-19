import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
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

/**
 * Static guards for the server-only ANBIMA composition boundary. They read the
 * source tree only: no build, no network, nothing environment dependent.
 */

// lib/aie/server/ -> frontend/
const FRONTEND_ROOT = fileURLToPath(
  new URL(
    "../../..",
    import.meta.url,
  ),
);

const BOUNDARY =
  "lib/aie/server/create-server-aie.ts";

/** Modules that must never be reachable from browser code. */
const SERVER_ONLY = [
  BOUNDARY,
  "lib/aie/server/resolve-asset.ts",
  "lib/aie/application/anbima-runtime.ts",
  "lib/aie/application/create-aie-from-env.ts",
  "lib/aie/infrastructure/anbima/anbima-http-client.ts",
];

const SCANNED_DIRECTORIES = [
  "app",
  "components",
  "lib",
];

function toPosix(
  path: string,
): string {
  return relative(
    FRONTEND_ROOT,
    path,
  ).replace(/\\/g, "/");
}

function listFiles(
  directory: string,
): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  const files: string[] = [];

  for (const entry of readdirSync(
    directory,
  )) {
    if (
      entry === "node_modules" ||
      entry === ".next"
    ) {
      continue;
    }

    const path = join(
      directory,
      entry,
    );

    if (
      statSync(path).isDirectory()
    ) {
      files.push(
        ...listFiles(path),
      );
    } else if (
      /\.(ts|tsx)$/.test(path)
    ) {
      files.push(path);
    }
  }

  return files;
}

function allSourceFiles(): string[] {
  return SCANNED_DIRECTORIES.flatMap(
    (directory) =>
      listFiles(
        join(
          FRONTEND_ROOT,
          directory,
        ),
      ),
  );
}

function productionFiles(): string[] {
  return allSourceFiles().filter(
    (file) =>
      !/\.test\.(ts|tsx)$/.test(file),
  );
}

function read(
  file: string,
): string {
  return readFileSync(
    file,
    "utf8",
  );
}

function isClientModule(
  file: string,
): boolean {
  return /^\s*["']use client["']/.test(
    read(file),
  );
}

function importSpecifiers(
  source: string,
): string[] {
  const specifiers: string[] = [];

  const pattern =
    /(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;

  for (const match of source.matchAll(
    pattern,
  )) {
    const specifier =
      match[1] ??
      match[2] ??
      match[3];

    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function resolveImport(
  from: string,
  specifier: string,
): string | null {
  let base: string;

  if (specifier.startsWith("@/")) {
    base = join(
      FRONTEND_ROOT,
      specifier.slice(2),
    );
  } else if (
    specifier.startsWith(".")
  ) {
    base = resolve(
      dirname(from),
      specifier,
    );
  } else {
    return null;
  }

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (
      existsSync(candidate) &&
      statSync(candidate).isFile()
    ) {
      return candidate;
    }
  }

  return null;
}

function reachableFrom(
  entry: string,
): Set<string> {
  const seen = new Set<string>();

  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;

    if (seen.has(file)) {
      continue;
    }

    seen.add(file);

    for (const specifier of importSpecifiers(
      read(file),
    )) {
      const resolved =
        resolveImport(
          file,
          specifier,
        );

      if (resolved) {
        queue.push(resolved);
      }
    }
  }

  return seen;
}

describe(
  "server-only ANBIMA composition boundary (static guards)",
  () => {
    it(
      "the boundary and its server-only dependencies exist",
      () => {
        for (const file of SERVER_ONLY) {
          expect(
            existsSync(
              join(
                FRONTEND_ROOT,
                file,
              ),
            ),
          ).toBe(true);
        }
      },
    );

    it(
      "no client module can reach the server runtime boundary",
      () => {
        const clientModules =
          allSourceFiles().filter(
            isClientModule,
          );

        // Sanity: the guard is not vacuous.
        expect(
          clientModules.length,
        ).toBeGreaterThan(0);

        const violations: string[] =
          [];

        for (const client of clientModules) {
          for (const file of reachableFrom(
            client,
          )) {
            const path =
              toPosix(file);

            if (
              SERVER_ONLY.includes(
                path,
              ) ||
              path.startsWith(
                "lib/aie/server/",
              )
            ) {
              violations.push(
                `${toPosix(client)} -> ${path}`,
              );
            }
          }
        }

        expect(
          violations,
        ).toEqual([]);
      },
    );

    it(
      "only the boundary reads the process environment for ANBIMA",
      () => {
        const readers =
          productionFiles()
            .filter((file) => {
              const source =
                read(file);

              return (
                source.includes(
                  "process.env",
                ) &&
                source.includes(
                  "ANBIMA",
                )
              );
            })
            .map(toPosix);

        expect(
          readers,
        ).toEqual([BOUNDARY]);
      },
    );

    it(
      "the boundary is not part of the public lib/aie barrel",
      () => {
        const barrel = read(
          join(
            FRONTEND_ROOT,
            "lib/aie/index.ts",
          ),
        );

        expect(
          barrel,
        ).not.toContain("server");
      },
    );

    it(
      "no NEXT_PUBLIC ANBIMA variable is introduced",
      () => {
        const candidates = [
          ...productionFiles(),
          join(
            FRONTEND_ROOT,
            ".env.example",
          ),
        ].filter(existsSync);

        const offenders =
          candidates
            .filter((file) =>
              read(file).includes(
                ["NEXT_PUBLIC", "ANBIMA"].join(
                  "_",
                ),
              ),
            )
            .map(toPosix);

        expect(
          offenders,
        ).toEqual([]);
      },
    );

    it(
      ".env.example documents only placeholder names for ANBIMA",
      () => {
        const example = read(
          join(
            FRONTEND_ROOT,
            ".env.example",
          ),
        );

        for (const line of example
          .split(/\r?\n/)
          .filter((entry) =>
            entry.startsWith("ANBIMA_"),
          )) {
          const [name, value] =
            line.split("=");

          expect(
            [
              "ANBIMA_CLIENT_ID",
              "ANBIMA_CLIENT_SECRET",
              "ANBIMA_ENVIRONMENT",
            ],
          ).toContain(name);

          if (
            name ===
            "ANBIMA_ENVIRONMENT"
          ) {
            expect([
              "production",
              "sandbox",
            ]).toContain(value);
          } else {
            expect(value).toBe("");
          }
        }
      },
    );
  },
);
