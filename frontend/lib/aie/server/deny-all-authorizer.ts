import type {
  AieRequestAuthorizer,
} from "./request-authorization";

/**
 * The fail-closed policy: no request is ever authorized. It is the production
 * authorizer whenever the identity integration is not (validly) configured.
 *
 * Kept in its own module (importing only types) so that the authorizer
 * composition can use it without a runtime import cycle.
 */
const DENY_ALL_AUTHORIZER: AieRequestAuthorizer =
  {
    authorize: async () => ({
      authorized: false,

      reason: "unauthenticated",
    }),
  };

export function createDenyAllAuthorizer(): AieRequestAuthorizer {
  return DENY_ALL_AUTHORIZER;
}
