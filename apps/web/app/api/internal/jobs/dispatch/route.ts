import { isAuthorizedCronRequest, isInternalDispatchAvailable, runOneInternalDispatch } from "../../../../../lib/kyozai/internal-dispatch";
import { publicErrorResponse, routeUnavailable } from "../../../../../lib/kyozai/http-errors";

export const runtime = "nodejs";

/** Vercel Cron entrypoint. It is an authenticated operational endpoint, never a public API. */
async function dispatch(request: Request) {
  try {
    if (!isInternalDispatchAvailable()) throw routeUnavailable();
    // Return the same response for a missing secret and a bad credential so the
    // operational route cannot be enumerated from the public internet.
    if (!isAuthorizedCronRequest(request)) throw routeUnavailable();
    return Response.json(await runOneInternalDispatch(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return publicErrorResponse(error, "内部jobの起動に失敗しました。");
  }
}

/** Vercel Cron invokes GET in Production; protected Preview checks invoke POST explicitly. */
export async function GET(request: Request) {
  return dispatch(request);
}

export async function POST(request: Request) {
  return dispatch(request);
}
