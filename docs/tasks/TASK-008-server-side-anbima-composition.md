# TASK-008 - Server-side ANBIMA composition boundary

## Objective

Connect the real process environment to the AIE only on the server, so that
`ANBIMA_CLIENT_SECRET` never reaches client-side code, a browser bundle or a React component.

    server-only boundary (lib/aie/server/create-server-aie.ts)
      -> process environment (the only reader)
      -> createAieFromEnv
      -> AnbimaHttpClient -> AnbimaDebentureProvider -> AssetResolutionEngine

## Detected architecture

- Next.js 15.5.9, App Router (`app/`), React 19, TypeScript, Vitest (node environment).
- Everything under `app/` is currently client code ("use client"); there are no API routes or
  server actions yet. The existing environment reads (`NEXT_PUBLIC_PLANEJADOR_API_URL`,
  `NEXT_PUBLIC_SITE_URL`) are public by design and unrelated to ANBIMA.
- The `server-only` package is NOT a dependency of this project, so it was not introduced.

## The boundary

- `frontend/lib/aie/server/create-server-aie.ts`
  - `createServerAie(options?)`: builds the engine from the process environment.
  - `getServerAie()`: process-wide engine (shares the in-memory OAuth token cache); failed
    configurations are not cached.
- It is the ONLY production module under `frontend/` that reads the process environment for the
  AIE. It forwards only the three ANBIMA variables, never the whole environment.
- It is deliberately NOT exported from the `lib/aie` barrel, and must not be imported from a
  "use client" module, a component or browser code.

## Environment variables (server-side only)

- `ANBIMA_CLIENT_ID`
- `ANBIMA_CLIENT_SECRET`
- `ANBIMA_ENVIRONMENT`: `production` (default) or `sandbox`

`frontend/.env.example` lists these names with empty placeholders only. Real values belong in an
untracked `.env.local`; no `.env` file is created or committed.

## Behavior

- No credentials: the engine starts with ANBIMA disabled and never contacts ANBIMA.
- Valid credentials: the engine includes `AnbimaDebentureProvider`.
- Incomplete credentials or an invalid environment: fails fast with the safe
  `AnbimaConfigurationError` (variable names only, never values).
- Constructing the engine performs no network request; the token is acquired lazily on first search.

## Prohibitions

- Never use the public prefix for any ANBIMA variable (a test fails if one is introduced).
- Never import the boundary, `anbima-runtime`, `create-aie-from-env` or `AnbimaHttpClient` from
  client code (a static import-graph test walks every "use client" module and fails on reachability).
- Never expose the client secret, access token, Authorization header, Basic credentials or the raw
  environment in API responses, logs or public errors.

## Defense in depth

- Next.js only inlines variables with the public prefix into browser bundles, so the ANBIMA
  variables are undefined in client code even if the module were bundled there.
- The boundary throws at load time if `window` exists.
- Static guard tests (offline, environment independent) cover the import graph, the single
  environment reader and the absence of public ANBIMA variables.

## Limitations

- No build-time "server-only" guard: adding the `server-only` package (plus a Vitest alias for it)
  would make an accidental client import fail at build time. It is a dependency change and needs
  explicit approval.
- `RegistryProvider` / `EntityRegistry` are a separate concern and are NOT registered by
  `createServerAie`; no production registry data is invented here.
- Nothing calls `getServerAie()` yet (see the next task: AIE server use-case/service).
- ANBIMA throttling (15 requests per second in production), retry/backoff, feed caching and the
  sandbox token URL confirmation remain open (see TASK-006).
