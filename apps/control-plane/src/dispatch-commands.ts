type DispatchRow = Record<string, unknown>;
export type DispatchCommand =
  | { command: "claim"; leaseOwner: string; now: string; leaseExpiresAt: string }
  | { command: "recordStarted"; dispatchId: string; leaseOwner: string; workflowRunId: string; now: string; leaseExpiresAt: string }
  | { command: "renewLease"; dispatchId: string; leaseOwner: string; now: string; leaseExpiresAt: string }
  | { command: "complete"; dispatchId: string; leaseOwner: string; now: string }
  | { command: "requeue"; dispatchId: string; leaseOwner: string; errorCode: string; now: string; nextAttemptAt: string };
export class DispatchCommandError extends Error { constructor(readonly code: "BAD_COMMAND" | "CONFLICT") { super(code); } }
const text = (v: unknown) => { if (typeof v !== "string" || !v.trim() || v.length > 512) throw new DispatchCommandError("BAD_COMMAND"); return v.trim(); };
export function parseDispatchCommand(value: unknown): DispatchCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DispatchCommandError("BAD_COMMAND"); const x = value as Record<string, unknown>;
  if (x.command === "claim") return { command: "claim", leaseOwner: text(x.leaseOwner), now: text(x.now), leaseExpiresAt: text(x.leaseExpiresAt) };
  if (x.command === "recordStarted") return { command: "recordStarted", dispatchId: text(x.dispatchId), leaseOwner: text(x.leaseOwner), workflowRunId: text(x.workflowRunId), now: text(x.now), leaseExpiresAt: text(x.leaseExpiresAt) };
  if (x.command === "renewLease") return { command: "renewLease", dispatchId: text(x.dispatchId), leaseOwner: text(x.leaseOwner), now: text(x.now), leaseExpiresAt: text(x.leaseExpiresAt) };
  if (x.command === "complete") return { command: "complete", dispatchId: text(x.dispatchId), leaseOwner: text(x.leaseOwner), now: text(x.now) };
  if (x.command === "requeue") return { command: "requeue", dispatchId: text(x.dispatchId), leaseOwner: text(x.leaseOwner), errorCode: text(x.errorCode), now: text(x.now), nextAttemptAt: text(x.nextAttemptAt) };
  throw new DispatchCommandError("BAD_COMMAND");
}

async function settleTerminalCandidate(db: D1Database, id: string, jobStatus: string, revisionStatus: string, now: string) {
  const status = jobStatus === "completed"
    ? "completed"
    : ["cancelling", "cancelled", "deleting", "deleted"].includes(jobStatus) || revisionStatus === "cancelled"
      ? "cancelled"
      : "failed";
  const errorCode = status === "failed" ? "dispatch_not_executable" : null;
  await db.prepare("UPDATE workflow_dispatches SET status = ?, completed_at = ?, lease_owner = NULL, lease_expires_at = NULL, last_error_code = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'dispatched')")
    .bind(status, now, errorCode, now, id).run();
}

export async function executeDispatchCommand(db: D1Database, x: DispatchCommand) {
  if (x.command === "claim") {
    const candidate = await db.prepare("SELECT d.id, j.status AS job_status, r.status AS revision_status FROM workflow_dispatches d JOIN jobs j ON j.id = d.job_id JOIN job_revisions r ON r.id = d.revision_id WHERE (d.status = 'pending' AND d.next_attempt_at <= ?) OR (d.status = 'dispatched' AND d.lease_expires_at <= ?) ORDER BY d.next_attempt_at, d.created_at LIMIT 1").bind(x.now, x.now).first<{ id: string; job_status: string; revision_status: string }>();
    if (!candidate) return { claimed: false };
    if (!["queued", "running"].includes(candidate.job_status) || !["queued", "running"].includes(candidate.revision_status)) {
      await settleTerminalCandidate(db, candidate.id, candidate.job_status, candidate.revision_status, x.now);
      return { claimed: false };
    }
    const claimed = await db.prepare("UPDATE workflow_dispatches SET status = 'dispatched', attempts = attempts + 1, lease_owner = ?, lease_expires_at = ?, dispatched_at = ?, workflow_run_id = NULL, last_error_code = CASE WHEN status = 'dispatched' THEN 'workflow_lease_expired' ELSE NULL END, updated_at = ? WHERE id = ? AND ((status = 'pending' AND next_attempt_at <= ?) OR (status = 'dispatched' AND lease_expires_at <= ?)) AND EXISTS (SELECT 1 FROM jobs WHERE id = workflow_dispatches.job_id AND status IN ('queued', 'running')) AND EXISTS (SELECT 1 FROM job_revisions WHERE id = workflow_dispatches.revision_id AND status IN ('queued', 'running'))").bind(x.leaseOwner, x.leaseExpiresAt, x.now, x.now, candidate.id, x.now, x.now).run();
    if (claimed.meta.changes !== 1) return { claimed: false };
    const dispatch = await db.prepare("SELECT id, job_id, revision_id, attempts, lease_owner FROM workflow_dispatches WHERE id = ? AND lease_owner = ?").bind(candidate.id, x.leaseOwner).first<DispatchRow>();
    if (!dispatch) throw new DispatchCommandError("CONFLICT"); return { claimed: true, dispatch };
  }
  if (x.command === "recordStarted" || x.command === "renewLease") {
    const workflowRunId = x.command === "recordStarted" ? x.workflowRunId : undefined;
    const result = await db.prepare("UPDATE workflow_dispatches SET workflow_run_id = COALESCE(?, workflow_run_id), started_at = CASE WHEN ? IS NULL THEN started_at ELSE COALESCE(started_at, ?) END, lease_expires_at = ?, updated_at = ? WHERE id = ? AND status = 'dispatched' AND lease_owner = ? AND lease_expires_at > ? AND (? IS NULL OR workflow_run_id IS NULL) AND EXISTS (SELECT 1 FROM jobs WHERE id = workflow_dispatches.job_id AND status IN ('queued', 'running')) AND EXISTS (SELECT 1 FROM job_revisions WHERE id = workflow_dispatches.revision_id AND status IN ('queued', 'running'))").bind(workflowRunId ?? null, workflowRunId ?? null, x.now, x.leaseExpiresAt, x.now, x.dispatchId, x.leaseOwner, x.now, workflowRunId ?? null).run();
    if (result.meta.changes !== 1) throw new DispatchCommandError("CONFLICT"); return { accepted: true };
  }
  if (x.command === "complete") {
    const result = await db.prepare("UPDATE workflow_dispatches SET status = CASE WHEN (SELECT status FROM jobs WHERE id = workflow_dispatches.job_id) = 'completed' THEN 'completed' ELSE 'cancelled' END, completed_at = ?, lease_owner = NULL, lease_expires_at = NULL, last_error_code = CASE WHEN (SELECT status FROM jobs WHERE id = workflow_dispatches.job_id) = 'completed' THEN NULL ELSE last_error_code END, updated_at = ? WHERE id = ? AND status = 'dispatched' AND lease_owner = ? AND lease_expires_at > ? AND (SELECT status FROM jobs WHERE id = workflow_dispatches.job_id) IN ('completed', 'cancelled', 'cancelling')").bind(x.now, x.now, x.dispatchId, x.leaseOwner, x.now).run();
    if (result.meta.changes !== 1) throw new DispatchCommandError("CONFLICT"); return { completed: true };
  }
  const result = await db.batch([
    db.prepare("UPDATE workflow_dispatches SET status = CASE WHEN (SELECT status FROM jobs WHERE id = workflow_dispatches.job_id) IN ('cancelling', 'cancelled', 'deleting', 'deleted') THEN 'cancelled' WHEN attempts >= 2 OR (SELECT status FROM jobs WHERE id = workflow_dispatches.job_id) = 'failed' THEN 'failed' ELSE 'pending' END, last_error_code = ?, next_attempt_at = ?, completed_at = CASE WHEN attempts >= 2 OR (SELECT status FROM jobs WHERE id = workflow_dispatches.job_id) IN ('cancelling', 'cancelled', 'deleting', 'deleted', 'failed') THEN ? ELSE completed_at END, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'dispatched' AND lease_owner = ?").bind(x.errorCode, x.nextAttemptAt, x.now, x.now, x.dispatchId, x.leaseOwner),
    db.prepare("UPDATE jobs SET status = 'failed', error_code = COALESCE(error_code, 'workflow_dispatch_failed'), current_stage = NULL, updated_at = ? WHERE id = (SELECT job_id FROM workflow_dispatches WHERE id = ?) AND status IN ('queued', 'running') AND (SELECT status FROM workflow_dispatches WHERE id = ?) = 'failed'").bind(x.now, x.dispatchId, x.dispatchId),
    db.prepare("UPDATE job_revisions SET status = 'failed', completed_at = ? WHERE id = (SELECT revision_id FROM workflow_dispatches WHERE id = ?) AND job_id = (SELECT job_id FROM workflow_dispatches WHERE id = ?) AND status IN ('queued', 'running') AND (SELECT status FROM workflow_dispatches WHERE id = ?) = 'failed'").bind(x.now, x.dispatchId, x.dispatchId, x.dispatchId),
  ]);
  if (result[0].meta.changes !== 1) throw new DispatchCommandError("CONFLICT"); return { requeued: true };
}
