import { publicErrorResponse, routeUnavailable } from "../../../../../lib/kyozai/http-errors";
import { isAuthorizedCronRequest, isInternalDispatchAvailable } from "../../../../../lib/kyozai/internal-dispatch";
import { runOneDeletionCleanup } from "../../../../../lib/kyozai/deletion-cleanup";

export const runtime = "nodejs";

/** Authenticated-only housekeeping; no browser route invokes private deletion. */
export async function GET(request: Request) {
  try {
    if (!isInternalDispatchAvailable() || !isAuthorizedCronRequest(request)) throw routeUnavailable();
    return Response.json(await runOneDeletionCleanup(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return publicErrorResponse(error, "内部削除処理に失敗しました。");
  }
}
