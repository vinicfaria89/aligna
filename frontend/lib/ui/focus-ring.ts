/**
 * Visible keyboard focus for the buttons and links of /carteira and /evolucao (TASK-028).
 * `.input` already draws its own focus ring; the `.btn-*` classes do not, and the
 * browser's default outline is white on the app's light background. Applied per element
 * (not in the global stylesheet) so the rest of the app keeps its current look.
 */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aligna-mid focus-visible:ring-offset-2";
