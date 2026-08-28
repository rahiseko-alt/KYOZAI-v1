export type ControlPlaneEnv = {
  DB: D1Database;
  SOURCE_BUCKET: R2Bucket;
  ARTIFACT_BUCKET: R2Bucket;
  KYOZAI_CONTROL_PLANE_TOKEN?: string;
  KYOZAI_SCHEDULER_TOKEN?: string;
  VERCEL_DISPATCH_URL?: string;
  VERCEL_CLEANUP_URL?: string;
};

import { executeJobCommand, JobCommandError, parseJobCommand } from "./job-commands";
import { executeStageCommand, StageCommandError, parseStageCommand } from "./stage-commands";
import { executeArtifactCommand, ArtifactCommandError, parseArtifactCommand } from "./artifact-commands";
import { ArtifactObjectError, getArtifactBytes, putArtifactBytes } from "./artifact-objects";

type Fetcher = typeof fetch;

const noStore = { "Cache-Control": "no-store" };

function unavailable() {
  return Response.json({ code: "CONTROL_PLANE_UNAVAILABLE" }, { status: 503, headers: noStore });
}

function isAuthorized(request: Request, token: string | undefined) {
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return Boolean(token && supplied && supplied === token);
}

async function bindingsReady(env: ControlPlaneEnv) {
  if (!env.DB || !env.SOURCE_BUCKET || !env.ARTIFACT_BUCKET) return false;
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    await Promise.all([
      env.SOURCE_BUCKET.head("__kyozai_binding_probe__"),
      env.ARTIFACT_BUCKET.head("__kyozai_binding_probe__"),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function health(env: ControlPlaneEnv) {
  if (!(await bindingsReady(env))) return unavailable();
  return Response.json({ status: "ok", storage: "private", acceptingNewJobs: false }, { headers: noStore });
}

function schedulerTarget(kind: "dispatch" | "cleanup", env: ControlPlaneEnv) {
  return kind === "dispatch" ? env.VERCEL_DISPATCH_URL : env.VERCEL_CLEANUP_URL;
}

export function scheduledKind(cron: string): "dispatch" | "cleanup" | undefined {
  if (cron === "*/5 * * * *") return "dispatch";
  if (cron === "17 */6 * * *") return "cleanup";
  return undefined;
}

export async function invokeScheduler(kind: "dispatch" | "cleanup", env: ControlPlaneEnv, fetcher: Fetcher) {
  const target = schedulerTarget(kind, env);
  if (!target || !env.KYOZAI_SCHEDULER_TOKEN) return false;
  try {
    const response = await fetcher(target, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.KYOZAI_SCHEDULER_TOKEN}`, "Cache-Control": "no-store" },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function handleControlPlaneRequest(request: Request, env: ControlPlaneEnv) {
  const pathname = new URL(request.url).pathname;
  if (request.method === "GET" && pathname === "/health") return health(env);
  if (pathname.startsWith("/internal/")) {
    if (!isAuthorized(request, env.KYOZAI_CONTROL_PLANE_TOKEN)) return new Response(null, { status: 404, headers: noStore });
    if (request.method === "POST" && pathname === "/internal/v1/jobs/commands" && await bindingsReady(env)) {
      try {
        const body = await request.json();
        return Response.json(await executeJobCommand(env.DB, parseJobCommand(body)), { headers: noStore });
      } catch (error) {
        if (error instanceof JobCommandError) return Response.json({ code: error.code }, { status: error.code === "SERVICE_UNAVAILABLE" ? 503 : error.code === "CONFLICT" ? 409 : error.code === "NOT_FOUND" ? 404 : 400, headers: noStore });
        return unavailable();
      }
    }
    if (request.method === "POST" && pathname === "/internal/v1/stages/commands" && await bindingsReady(env)) {
      try {
        return Response.json(await executeStageCommand(env.DB, parseStageCommand(await request.json())), { headers: noStore });
      } catch (error) {
        if (error instanceof StageCommandError) return Response.json({ code: error.code }, { status: error.code === "CONFLICT" ? 409 : 400, headers: noStore });
        return unavailable();
      }
    }
    if (request.method === "POST" && pathname === "/internal/v1/artifacts/commands" && await bindingsReady(env)) {
      try {
        return Response.json(await executeArtifactCommand(env.DB, parseArtifactCommand(await request.json())), { headers: noStore });
      } catch (error) {
        if (error instanceof ArtifactCommandError) return Response.json({ code: error.code }, { status: error.code === "CONFLICT" ? 409 : 400, headers: noStore });
        return unavailable();
      }
    }
    if ((request.method === "PUT" || request.method === "GET") && /^\/internal\/v1\/artifacts\/[^/]+\/bytes$/.test(pathname) && await bindingsReady(env)) {
      try {
        if (request.method === "PUT") return Response.json(await putArtifactBytes(request, env.DB, env.SOURCE_BUCKET, env.ARTIFACT_BUCKET), { headers: noStore });
        return await getArtifactBytes(request, env.DB, env.SOURCE_BUCKET, env.ARTIFACT_BUCKET);
      } catch (error) {
        if (error instanceof ArtifactObjectError) return Response.json({ code: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 409, headers: noStore });
        return unavailable();
      }
    }
    return unavailable();
  }
  return new Response(null, { status: 404, headers: noStore });
}

export default {
  fetch(request: Request, env: ControlPlaneEnv) {
    return handleControlPlaneRequest(request, env);
  },
  async scheduled(controller: ScheduledController, env: ControlPlaneEnv, ctx: ExecutionContext) {
    const kind = scheduledKind(controller.cron);
    if (!kind || !(await bindingsReady(env))) {
      controller.noRetry();
      return;
    }
    ctx.waitUntil(invokeScheduler(kind, env, fetch));
  },
};
