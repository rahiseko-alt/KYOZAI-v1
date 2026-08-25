import { readBoundedText } from "../../../lib/kyozai/bounded-body";
import { publicErrorResponse, badRequest } from "../../../lib/kyozai/http-errors";
import { requireAsyncJobsEnabled, requireJobUser } from "../../../lib/kyozai/job-auth";
import { createUpload } from "../../../lib/kyozai/job-store";
import { DURABLE_JOB_RATE_LIMIT_POLICY } from "../../../lib/kyozai/generation-policy";
import { enforceRateLimit } from "../../../lib/kyozai/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireAsyncJobsEnabled();
    await enforceRateLimit(request, DURABLE_JOB_RATE_LIMIT_POLICY);
    const user = await requireJobUser(request);
    const raw = await readBoundedText(request, 8 * 1024, "アップロード要求が上限を超えています。");
    let body: { filename?: unknown; mediaType?: unknown; byteSize?: unknown };
    try { body = JSON.parse(raw) as typeof body; } catch { throw badRequest("アップロード要求の形式が不正です。"); }
    if (typeof body.filename !== "string" || typeof body.mediaType !== "string" || !Number.isInteger(body.byteSize)) throw badRequest("アップロードするファイルを確認できません。");
    return Response.json(await createUpload(user, { filename: body.filename, mediaType: body.mediaType, byteSize: body.byteSize as number }), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return publicErrorResponse(error, "アップロードの準備をできませんでした。時間を置いてもう一度お試しください。");
  }
}
