import { readBoundedText } from "../../../lib/kyozai/bounded-body";
import { badRequest, publicErrorResponse } from "../../../lib/kyozai/http-errors";
import { requireAsyncJobsEnabled, requireJobUser } from "../../../lib/kyozai/job-auth";
import { createJob, listJobs, type CreateJobRequest } from "../../../lib/kyozai/job-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireAsyncJobsEnabled();
    const user = await requireJobUser(request);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey) throw badRequest("Idempotency-Keyを指定してください。");
    const raw = await readBoundedText(request, 96 * 1024, "job要求が上限を超えています。");
    let body: CreateJobRequest;
    try { body = JSON.parse(raw) as CreateJobRequest; } catch { throw badRequest("job要求の形式が不正です。"); }
    const jobId = await createJob(user, body, idempotencyKey);
    return Response.json({ jobId, statusUrl: `/api/jobs/${jobId}` }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return publicErrorResponse(error, "教材jobを受け付けできませんでした。時間を置いてもう一度お試しください。");
  }
}

export async function GET(request: Request) {
  try {
    requireAsyncJobsEnabled();
    const user = await requireJobUser(request);
    return Response.json({ jobs: await listJobs(user) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return publicErrorResponse(error, "job履歴を取得できませんでした。時間を置いてもう一度お試しください。");
  }
}
