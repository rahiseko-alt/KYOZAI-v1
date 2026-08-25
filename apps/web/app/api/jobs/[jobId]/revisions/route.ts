import { readBoundedText } from "../../../../../lib/kyozai/bounded-body";
import { badRequest, publicErrorResponse } from "../../../../../lib/kyozai/http-errors";
import { requireAsyncJobsEnabled, requireJobUser } from "../../../../../lib/kyozai/job-auth";
import { createRevisionCandidate } from "../../../../../lib/kyozai/job-store";

export const runtime = "nodejs";
type Context = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    requireAsyncJobsEnabled();
    const user = await requireJobUser(request);
    const raw = await readBoundedText(request, 8 * 1024, "修正要求が上限を超えています。");
    let body: { baseRevision?: unknown; instruction?: unknown };
    try { body = JSON.parse(raw) as typeof body; } catch { throw badRequest("修正要求の形式が不正です。"); }
    if (!Number.isInteger(body.baseRevision) || typeof body.instruction !== "string") throw badRequest("baseRevisionと修正指示を指定してください。");
    const { jobId } = await context.params;
    const result = await createRevisionCandidate(user, jobId, body.baseRevision as number, body.instruction);
    return Response.json(result, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return publicErrorResponse(error, "修正版を準備できませんでした。");
  }
}
