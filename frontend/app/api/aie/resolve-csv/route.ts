import {
  handleResolveCsvRequest,
} from "../../../../lib/aie/server/resolve-csv-http";

/**
 * POST /api/aie/resolve-csv
 *
 * Thin Route Handler: raw CSV text (Content-Type: text/csv) resolved through the
 * same authorized, rate-limited, audited batch pipeline as resolve-assets. All
 * validation and mapping live in the server-only AIE boundary. Only POST is
 * exported; the framework answers other methods with 405. This file must not read
 * the process environment or import provider/runtime details (see TASK-024).
 */
export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
): Promise<Response> {
  return handleResolveCsvRequest(
    request,
  );
}
