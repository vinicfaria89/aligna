# TASK-007 - ANBIMA runtime configuration

## Objective

Connect AnbimaHttpClient to the application runtime without putting secrets in code and
without coupling any provider to the process environment.

    environment-like object
      -> resolveAnbimaRuntimeConfig
      -> AnbimaHttpClient
      -> AnbimaDebentureProvider
      -> EvidenceProviderRegistry
      -> createAie({ providers })

## Variables

- ANBIMA_CLIENT_ID
- ANBIMA_CLIENT_SECRET
- ANBIMA_ENVIRONMENT: "production" (default) or "sandbox" (case-insensitive, trimmed)

## Behavior

- The environment is an INJECTED object (Record<string, string | undefined>). Nothing under
  lib/aie reads the process environment; the application boundary passes it in. A test
  enforces this for every non-test source file.
- No credentials at all: ANBIMA is disabled. createAnbimaDebentureProviderFromEnv returns
  null (chosen over a "disabled result" object to keep call sites trivial and to make it
  impossible to hold a half-configured provider).
- Only one credential: AnbimaConfigurationError (INCOMPLETE_CREDENTIALS).
- Blank values count as not set.
- ANBIMA_ENVIRONMENT is validated whenever it is set, even without credentials
  (INVALID_ENVIRONMENT), so a typo never silently means production.
- Error messages contain variable names only, never values. Nothing is logged.
- createAie(options?) only registers providers passed explicitly. createAieFromEnv(env, options?)
  registers ANBIMA only when the environment provides valid credentials.
- Creating the provider performs no request: the OAuth token is acquired lazily on first search.

## Secrets

- No .env file is created or committed (frontend/.gitignore already ignores .env*).
- Tests use obviously fake sentinel values and a fake fetch; the global fetch is stubbed to fail
  the test if a real network call is attempted.

## Out of scope / limitations

- Reading the real process environment (a Next.js server-side boundary must call
  createAieFromEnv(process.env) itself).
- Registering RegistryProvider/EntityRegistry in createAieFromEnv.
- Throttling (ANBIMA production limit: 15 requests per second), retry/backoff, feed caching.
- Sandbox token URL confirmation (see TASK-006).
