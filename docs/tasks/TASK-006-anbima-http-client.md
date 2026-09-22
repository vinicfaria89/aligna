# TASK-006 - ANBIMA HTTP Client

## Objective

Implement the HTTP/authentication boundary behind AnbimaDebentureFeedClient.

    AnbimaDebentureProvider
      -> AnbimaDebentureFeedClient
      -> AnbimaHttpClient

The provider stays unaware of OAuth, fetch, URLs, tokens, retries and rate limiting.
AnbimaHttpClient never produces evidence and never interprets the textual issuer.

## Official ANBIMA facts

- Token: POST https://api.anbima.com.br/oauth/access-token
  - Authorization: Basic base64(client_id:client_secret)
  - Content-Type: application/json
  - Body: {"grant_type":"client_credentials"}
  - Response: access_token, token_type, expires_in (official example: 3600)
- Feed headers: client_id, access_token, Content-Type: application/json
- Base URLs: production https://api.anbima.com.br, sandbox https://api-sandbox.anbima.com.br
- Endpoint: GET /feed/precos-indices/v1/debentures/mercado-secundario
- Only documented query parameter: data=YYYY-MM-DD (optional). When omitted, ANBIMA returns
  the most recent available reference date. The client never sends it.
- No documented server-side filter by codigo_ativo: the feed is fetched and the exact
  (trim + uppercase) match is done locally. No fuzzy matching.
- Production limit: up to 15 requests per second.

## Behavior

- Token acquired lazily, cached in memory, refreshed when expires_in is reached (small safety
  margin). Concurrent lookups share one in-flight token request.
- Feed 401: the cached token is invalidated and the request is retried exactly once.
  A second 401 fails.
- Parsing is defensive and isolated in one function. Only a direct JSON array of records is
  accepted; malformed records are rejected. A code listed with different issuers is rejected
  instead of guessed.
- Errors are AnbimaHttpError with a code and optional HTTP status. Messages never contain
  credentials, tokens, headers or response bodies.
- Credentials come from the constructor configuration only. Nothing is read from process.env
  here; env wiring belongs to a separate factory.

## Out of scope / limitations

- Throttling for the 15 req/s limit and the feed cache. (At the time of TASK-006 every lookup performed one
  feed request; both were added by TASK-015.)
- Retry/backoff beyond the single 401 retry.
- Pagination (none is documented for this endpoint).
- Sandbox token URL: not confirmed by the documentation. The production token URL is the
  default for both environments; `tokenUrl` overrides it.
- Environment/secret wiring and registering the client in createAie().

## Testing

All tests are offline with a fake fetch; the global fetch is stubbed to fail the test if a
real network call is attempted. Fixtures use obviously fake credentials.
