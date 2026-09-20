import {
  createNoopAuditSink,
} from "./aie-audit";

import type {
  AieAuditSink,
} from "./aie-audit";

/**
 * SERVER-ONLY audit sink composition (TASK-022).
 *
 * TODAY THIS IS A NO-OP. The repository has no established audit storage or
 * structured logging mechanism, and this task deliberately invents none: it
 * fixes the audit CONTRACT and the emission points. Consequently NO audit
 * record is durably stored yet, the 90-day retention target of TASK-019 is not
 * enforced, and nothing here is compliance-grade auditing.
 *
 * When durable storage is chosen, replace the returned sink here (and only
 * here); routes, authorizers and handlers do not change. This module reads no
 * environment and performs no network request.
 */
const NOOP_SINK: AieAuditSink =
  createNoopAuditSink();

export function getAieAuditSink(): AieAuditSink {
  return NOOP_SINK;
}
