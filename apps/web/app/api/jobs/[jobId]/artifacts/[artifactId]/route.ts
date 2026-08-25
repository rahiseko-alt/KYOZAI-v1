import { publicErrorResponse } from "../../../../../../lib/kyozai/http-errors";
import { requireAsyncJobsEnabled, requireJobUser } from "../../../../../../lib/kyozai/job-auth";
import { createArtifactRedirect } from "../../../../../../lib/kyozai/job-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ jobId: string; artifactId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    requireAsyncJobsEnabled();
    const user = await requireJobUser(request);
    const { jobId, artifactId } = await context.params;
    const location = await createArtifactRedirect(user, jobId, artifactId);
    return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
  } catch (error) {
    return publicErrorResponse(error, "成果物を取得できませんでした。時間を置いてもう一度お試しください。");
  }
}
