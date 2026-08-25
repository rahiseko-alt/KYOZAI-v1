import { publicErrorResponse } from "../../../../lib/kyozai/http-errors";
import { requireAsyncJobsEnabled, requireJobUser } from "../../../../lib/kyozai/job-auth";
import { cancelJob, deleteJob, getJobSnapshot } from "../../../../lib/kyozai/job-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    requireAsyncJobsEnabled();
    const user = await requireJobUser(request);
    const { jobId } = await context.params;
    return Response.json(await getJobSnapshot(user, jobId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return publicErrorResponse(error, "jobを取得できませんでした。時間を置いてもう一度お試しください。");
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    requireAsyncJobsEnabled();
    const user = await requireJobUser(request);
    const { jobId } = await context.params;
    await deleteJob(user, jobId);
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return publicErrorResponse(error, "jobを削除できませんでした。時間を置いてもう一度お試しください。");
  }
}

export async function POST(request: Request, context: Context) {
  try {
    requireAsyncJobsEnabled();
    const user = await requireJobUser(request);
    const { jobId } = await context.params;
    await cancelJob(user, jobId);
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return publicErrorResponse(error, "jobをキャンセルできませんでした。時間を置いてもう一度お試しください。");
  }
}
