/**
 * Post-login return destinations (TASK-027).
 *
 * `/evolucao?voltar=<path>` may send the user somewhere after a SUCCESSFUL sign-in,
 * but only to a fixed, explicit list of internal routes. This is deliberately not a
 * redirect framework: the value is compared, whole and as-is, with the entries below.
 * There is no URL parsing or normalization, no prefix or substring matching and no
 * pattern that admits arbitrary paths, so absolute URLs, `//host`, `javascript:`,
 * traversal, query/fragment suffixes, other casing, trailing slashes and
 * percent-encoded lookalikes are all rejected simply because they are not equal to
 * an entry. Browser-safe: no environment, no storage.
 */

export const ALLOWED_POST_LOGIN_RETURN_PATHS = [
  "/carteira",
] as const;

export type PostLoginReturnPath =
  (typeof ALLOWED_POST_LOGIN_RETURN_PATHS)[number];

/** The sign-in screen and the query parameter that carries the return path. */
export const LOGIN_PATH = "/evolucao";

export const POST_LOGIN_RETURN_PARAM = "voltar";

/** The allow-listed destination for `value`, or `null` (use the default flow). */
export function getSafePostLoginReturnPath(
  value: string | null | undefined,
): PostLoginReturnPath | null {
  for (const allowed of ALLOWED_POST_LOGIN_RETURN_PATHS) {
    if (value === allowed) {
      return allowed;
    }
  }

  return null;
}

/**
 * The sign-in link that returns to `path`. The path type only admits allow-listed
 * routes, and nothing else (no token, file name, CSV data or id) is ever put in it.
 */
export function loginHrefReturningTo(
  path: PostLoginReturnPath,
): string {
  return `${LOGIN_PATH}?${POST_LOGIN_RETURN_PARAM}=${path}`;
}
