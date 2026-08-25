import { createHash, timingSafeEqual } from "node:crypto";

import { createServerSupabaseClient } from "../supabase/server";
import { start } from "workflow/api";
import { durableKyozaiJobWorkflow } from "../../workflows/kyozai-job-workflow";

export type ClaimedWorkflowDispatch = {
  id: string;
  jobId: string;
  revisionId: string;
  attempts: number;
  leaseOwner: string;
};

export type InternalDispatchResult =
  | { claimed: false }
  | { claimed: true; dispatchId: string; jobId: string; attempts: number; workflowRunId: string };

export class InternalDispatchError extends Error {
  constructor(readonly code: "dispatch_claim_failed" | "workflow_start_failed" | "dispatch_complete_failed" | "dispatch_requeue_failed") {
    super(code);
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/**
 * Vercel Cron sends CRON_SECRET as a Bearer credential. Hashing first keeps the
 * timing-safe comparison valid even when a malformed caller supplies a different length.
 */
export function isAuthorizedCronRequest(request: Request, env: Record<string, string | undefined> = process.env) {
  const configuredSecret = env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!configuredSecret || !supplied) return false;
  return timingSafeEqual(digest(configuredSecret), digest(supplied));
}

export function isInternalDispatchAvailable(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.CRON_SECRET?.trim());
}

function asClaimedDispatch(value: unknown): ClaimedWorkflowDispatch | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.job_id !== "string" || typeof row.revision_id !== "string"
    || typeof row.lease_owner !== "string" || !Number.isInteger(row.attempts)) return undefined;
  return { id: row.id, jobId: row.job_id, revisionId: row.revision_id, attempts: row.attempts as number, leaseOwner: row.lease_owner };
}

export async function claimOneWorkflowDispatch(): Promise<ClaimedWorkflowDispatch | undefined> {
  const { data, error } = await createServerSupabaseClient().rpc("claim_next_kyozai_workflow_dispatch");
  if (error) throw new InternalDispatchError("dispatch_claim_failed");
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length === 0) return undefined;
  if (rows.length !== 1) throw new InternalDispatchError("dispatch_claim_failed");
  const claimed = asClaimedDispatch(rows[0]);
  if (!claimed) throw new InternalDispatchError("dispatch_claim_failed");
  return claimed;
}

export async function requeueWorkflowDispatch(dispatchId: string, leaseOwner: string, errorCode: string) {
  const { error } = await createServerSupabaseClient().rpc("requeue_kyozai_workflow_dispatch_v2", {
    p_dispatch_id: dispatchId,
    p_lease_owner: leaseOwner,
    p_error_code: errorCode,
  });
  if (error) throw new InternalDispatchError("dispatch_requeue_failed");
}

export async function completeWorkflowDispatch(dispatchId: string, leaseOwner: string) {
  const { data, error } = await createServerSupabaseClient().rpc("complete_kyozai_workflow_dispatch_v2", {
    p_dispatch_id: dispatchId,
    p_lease_owner: leaseOwner,
  });
  if (error || data !== true) throw new InternalDispatchError("dispatch_complete_failed");
}

export async function startClaimedWorkflow(dispatch: ClaimedWorkflowDispatch): Promise<string> {
  const run = await start(durableKyozaiJobWorkflow, [{ dispatchId: dispatch.id, jobId: dispatch.jobId, revisionId: dispatch.revisionId, leaseOwner: dispatch.leaseOwner }]);
  const { data, error } = await createServerSupabaseClient().rpc("record_kyozai_workflow_started", {
    p_dispatch_id: dispatch.id,
    p_lease_owner: dispatch.leaseOwner,
    p_workflow_run_id: run.runId,
  });
  if (error || data !== true) throw new InternalDispatchError("workflow_start_failed");
  return run.runId;
}

export async function runOneInternalDispatch(): Promise<InternalDispatchResult> {
  const dispatch = await claimOneWorkflowDispatch();
  if (!dispatch) return { claimed: false };
  try {
    const workflowRunId = await startClaimedWorkflow(dispatch);
    return { claimed: true, dispatchId: dispatch.id, jobId: dispatch.jobId, attempts: dispatch.attempts, workflowRunId };
  } catch (error) {
    const code = error instanceof InternalDispatchError ? error.code : "workflow_start_failed";
    try {
      await requeueWorkflowDispatch(dispatch.id, dispatch.leaseOwner, code);
    } catch {
      throw new InternalDispatchError("dispatch_requeue_failed");
    }
    throw new InternalDispatchError("workflow_start_failed");
  }
}
