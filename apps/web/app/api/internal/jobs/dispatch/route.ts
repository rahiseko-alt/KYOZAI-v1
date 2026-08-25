import { isAuthorizedCronRequest, isInternalDispatchAvailable, runOneInternalDispatch } from "../../../../../lib/kyozai/internal-dispatch";
import { isPublicProduction } from "../../../../../lib/kyozai/generation-access";
import { publicErrorResponse, routeUnavailable, unauthorized } from "../../../../../lib/kyozai/http-errors";

export const runtime = "nodejs";

/** Vercel Cron entrypoint. It is intentionally never available on public Production. */
async function dispatch(request: Request) {
  try {
    if (isPublicProduction()) throw routeUnavailable();
    if (!isInternalDispatchAvailable()) throw routeUnavailable();
    if (!isAuthorizedCronRequest(request)) throw unauthorized("内部処理の認証に失敗しました。");
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
