import {
  handleResolveAssetsRequest,
} from "../../../../lib/aie/server/resolve-assets-http";

/**
 * POST /api/aie/resolve-assets
 *
 * Thin Route Handler: all validation and mapping live in the server-only AIE
 * boundary. Only POST is exported; the framework answers other methods with 405.
 * This file must not read the process environment or import provider/runtime
 * details (see TASK-016). Authentication/authorization is not implemented yet
 * and is required before public exposure.
 */
export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
): Promise<Response> {
  return handleResolveAssetsRequest(
    request,
  );
}
