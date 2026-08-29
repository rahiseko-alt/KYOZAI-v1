type JobRow = Record<string, unknown>;

export type JobCommand =
  | { command: "create"; ownerId: string; jobId: string; revisionId: string; dispatchId: string; reservationId: string; idempotencyKey: string; inputKind: "text" | "url" | "attachments" | "mixed"; requestJson: string; imageModel: string; workflowVersion: string; now: string; expiresAt: string; reservationExpiresAt: string; reservedImageCalls: number; reservedCostUnits: number }
  | { command: "list"; ownerId: string }
  | { command: "read"; ownerId: string; jobId: string }
  | { command: "cancel"; ownerId: string; jobId: string; now: string }
  | { command: "delete"; ownerId: string; jobId: string; now: string }
  | { command: "workflowRead"; jobId: string }
  | { command: "workflowComplete"; jobId: string; revisionId: string; now: string }
  | { command: "workflowFail"; jobId: string; now: string }
  | { command: "settlePendingCancellations"; now: string; limit: number };

export class JobCommandError extends Error {
  constructor(readonly code: "BAD_COMMAND" | "NOT_FOUND" | "CONFLICT" | "SERVICE_UNAVAILABLE") {
    super(code);
  }
}

function requiredText(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) throw new JobCommandError("BAD_COMMAND");
  return value.trim();
}

function requiredInteger(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) throw new JobCommandError("BAD_COMMAND");
  return value;
}

function commandName(value: unknown) {
  if (value === "create" || value === "list" || value === "read" || value === "cancel" || value === "delete" || value === "workflowRead" || value === "workflowComplete" || value === "workflowFail" || value === "settlePendingCancellations") return value;
  throw new JobCommandError("BAD_COMMAND");
}

export function parseJobCommand(value: unknown): JobCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new JobCommandError("BAD_COMMAND");
  const input = value as Record<string, unknown>;
  const command = commandName(input.command);
  if (command === "settlePendingCancellations") {
    return { command, now: requiredText(input.now, "now"), limit: input.limit === undefined ? 25 : requiredInteger(input.limit, 1, 50) };
  }
  if (command === "workflowRead") return { command, jobId: requiredText(input.jobId, "jobId") };
  if (command === "workflowComplete") return { command, jobId: requiredText(input.jobId, "jobId"), revisionId: requiredText(input.revisionId, "revisionId"), now: requiredText(input.now, "now") };
  if (command === "workflowFail") return { command, jobId: requiredText(input.jobId, "jobId"), now: requiredText(input.now, "now") };
  const ownerId = requiredText(input.ownerId, "ownerId");
  if (command === "create") {
    const inputKind = input.inputKind;
    if (inputKind !== "text" && inputKind !== "url" && inputKind !== "attachments" && inputKind !== "mixed") throw new JobCommandError("BAD_COMMAND");
    const requestJson = requiredText(input.requestJson, "requestJson");
    try { JSON.parse(requestJson); } catch { throw new JobCommandError("BAD_COMMAND"); }
    const reservedImageCalls = requiredInteger(input.reservedImageCalls, 0, 24);
    const reservedCostUnits = requiredInteger(input.reservedCostUnits, 0, Number.MAX_SAFE_INTEGER);
    return { command, ownerId, jobId: requiredText(input.jobId, "jobId"), revisionId: requiredText(input.revisionId, "revisionId"), dispatchId: requiredText(input.dispatchId, "dispatchId"), reservationId: requiredText(input.reservationId, "reservationId"), idempotencyKey: requiredText(input.idempotencyKey, "idempotencyKey"), inputKind, requestJson, imageModel: requiredText(input.imageModel, "imageModel"), workflowVersion: requiredText(input.workflowVersion, "workflowVersion"), now: requiredText(input.now, "now"), expiresAt: requiredText(input.expiresAt, "expiresAt"), reservationExpiresAt: requiredText(input.reservationExpiresAt, "reservationExpiresAt"), reservedImageCalls, reservedCostUnits };
  }
  if (command === "list") return { command, ownerId };
  const jobId = requiredText(input.jobId, "jobId");
  if (command === "read") return { command, ownerId, jobId };
  const now = requiredText(input.now, "now");
  return { command, ownerId, jobId, now };
}

async function ownedJob(db: D1Database, ownerId: string, jobId: string) {
  return db.prepare("SELECT id, status, active_revision_number, current_stage, error_code FROM jobs WHERE id = ? AND owner_id = ?")
    .bind(jobId, ownerId).first<JobRow>();
}

async function settleCancellation(db: D1Database, jobId: string, now: string) {
  const job = await db.prepare("SELECT status FROM jobs WHERE id = ?").bind(jobId).first<{ status: string }>();
  if (!job || (job.status !== "cancelling" && job.status !== "cancelled")) return false;

  await db.prepare("UPDATE stage_runs SET status = 'skipped', started_at = COALESCE(started_at, ?), completed_at = ?, lease_owner = NULL, lease_expires_at = NULL, error_code = 'job_cancelled' WHERE job_id = ? AND (status = 'pending' OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)))")
    .bind(now, now, jobId, now).run();
  const result = await db.batch([
    db.prepare("UPDATE usage_events SET charge_state = 'ambiguous', actual_cost_units = estimated_cost_units WHERE job_id = ? AND charge_state = 'reserved' AND NOT EXISTS (SELECT 1 FROM stage_runs WHERE job_id = ? AND status = 'running' AND lease_expires_at > ?)").bind(jobId, jobId, now),
    db.prepare("UPDATE jobs SET status = 'cancelled', current_stage = NULL, updated_at = ? WHERE id = ? AND status IN ('cancelling', 'cancelled') AND NOT EXISTS (SELECT 1 FROM stage_runs WHERE job_id = ? AND status = 'running' AND lease_expires_at > ?)").bind(now, jobId, jobId, now),
    db.prepare("UPDATE job_revisions SET status = 'cancelled', completed_at = ? WHERE job_id = ? AND status IN ('queued', 'running') AND NOT EXISTS (SELECT 1 FROM stage_runs WHERE job_id = ? AND status = 'running' AND lease_expires_at > ?)").bind(now, jobId, jobId, now),
    db.prepare("UPDATE workflow_dispatches SET status = 'cancelled', completed_at = ?, lease_owner = NULL, lease_expires_at = NULL, last_error_code = 'job_cancelled', updated_at = ? WHERE job_id = ? AND status IN ('pending', 'dispatched') AND NOT EXISTS (SELECT 1 FROM stage_runs WHERE job_id = ? AND status = 'running' AND lease_expires_at > ?)").bind(now, now, jobId, jobId, now),
    db.prepare("UPDATE quota_reservations SET confirmed_image_calls = COALESCE((SELECT SUM(CASE WHEN charge_state IN ('confirmed', 'ambiguous') THEN image_count ELSE 0 END) FROM usage_events WHERE job_id = ?), 0), confirmed_cost_units = COALESCE((SELECT SUM(CASE WHEN charge_state IN ('confirmed', 'ambiguous') THEN actual_cost_units ELSE 0 END) FROM usage_events WHERE job_id = ?), 0), reserved_image_calls = COALESCE((SELECT SUM(CASE WHEN charge_state IN ('confirmed', 'ambiguous') THEN image_count ELSE 0 END) FROM usage_events WHERE job_id = ?), 0), reserved_cost_units = COALESCE((SELECT SUM(CASE WHEN charge_state IN ('confirmed', 'ambiguous') THEN actual_cost_units ELSE 0 END) FROM usage_events WHERE job_id = ?), 0), inflight_image_calls = 0, inflight_cost_units = 0, charge_state = CASE WHEN EXISTS (SELECT 1 FROM usage_events WHERE job_id = ? AND charge_state = 'ambiguous') THEN 'ambiguous' WHEN COALESCE((SELECT SUM(CASE WHEN charge_state IN ('confirmed', 'ambiguous') THEN actual_cost_units ELSE 0 END) FROM usage_events WHERE job_id = ?), 0) = 0 THEN 'released' ELSE 'confirmed' END, released_at = ? WHERE job_id = ? AND NOT EXISTS (SELECT 1 FROM stage_runs WHERE job_id = ? AND status = 'running' AND lease_expires_at > ?)").bind(jobId, jobId, jobId, jobId, jobId, jobId, now, jobId, jobId, now),
  ]);
  return result[1].meta.changes === 1;
}

export async function executeJobCommand(db: D1Database, input: JobCommand) {
  if (input.command === "settlePendingCancellations") {
    const candidates = await db.prepare("SELECT j.id FROM jobs j JOIN quota_reservations q ON q.job_id = j.id WHERE j.status = 'cancelling' OR (j.status = 'cancelled' AND q.released_at IS NULL) ORDER BY j.updated_at LIMIT ?").bind(input.limit).all<{ id: string }>();
    let settled = 0;
    for (const candidate of candidates.results) if (await settleCancellation(db, candidate.id, input.now)) settled += 1;
    return { settled };
  }
  if (input.command === "create") {
    const existing = await db.prepare("SELECT id, input_kind, request_json, image_model FROM jobs WHERE owner_id = ? AND idempotency_key = ?")
      .bind(input.ownerId, input.idempotencyKey).first<JobRow>();
    if (existing) {
      if (existing.input_kind === input.inputKind && existing.request_json === input.requestJson && existing.image_model === input.imageModel) return { jobId: existing.id, idempotent: true };
      throw new JobCommandError("CONFLICT");
    }
    const dayStart = `${input.now.slice(0, 10)}T00:00:00.000Z`;
    const monthStart = `${input.now.slice(0, 7)}-01T00:00:00.000Z`;
    const statements = await db.batch([
      db.prepare("INSERT INTO jobs (id, owner_id, status, workflow_version, input_kind, request_json, image_model, idempotency_key, expires_at, created_at, updated_at) SELECT ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ? FROM system_controls WHERE id = 1 AND accept_new_jobs = 1 AND cloudflare_usage_within_budget = 1 AND EXISTS (SELECT 1 FROM json_each(system_controls.allowed_models_json) WHERE value = ?) AND (SELECT COALESCE(SUM(reserved_image_calls), 0) FROM quota_reservations WHERE created_at >= ? AND charge_state <> 'released') + ? <= monthly_image_call_limit AND (SELECT COUNT(*) FROM jobs WHERE owner_id = ? AND created_at >= ?) < 3 AND NOT EXISTS (SELECT 1 FROM jobs WHERE owner_id = ? AND status IN ('queued', 'running', 'cancelling'))")
        .bind(input.jobId, input.ownerId, input.workflowVersion, input.inputKind, input.requestJson, input.imageModel, input.idempotencyKey, input.expiresAt, input.now, input.now, input.imageModel, monthStart, input.reservedImageCalls, input.ownerId, dayStart, input.ownerId),
      db.prepare("INSERT INTO job_revisions (id, job_id, revision_number, status, created_at) SELECT ?, ?, 1, 'queued', ? WHERE EXISTS (SELECT 1 FROM jobs WHERE id = ? AND owner_id = ?)")
        .bind(input.revisionId, input.jobId, input.now, input.jobId, input.ownerId),
      db.prepare("INSERT INTO quota_reservations (id, job_id, owner_id, reserved_image_calls, reserved_cost_units, charge_state, expires_at, created_at) SELECT ?, ?, ?, ?, ?, 'reserved', ?, ? WHERE EXISTS (SELECT 1 FROM jobs WHERE id = ? AND owner_id = ?)")
        .bind(input.reservationId, input.jobId, input.ownerId, input.reservedImageCalls, input.reservedCostUnits, input.reservationExpiresAt, input.now, input.jobId, input.ownerId),
      db.prepare("INSERT INTO workflow_dispatches (id, job_id, revision_id, status, next_attempt_at, created_at, updated_at) SELECT ?, ?, ?, 'pending', ?, ?, ? WHERE EXISTS (SELECT 1 FROM jobs WHERE id = ? AND owner_id = ?)")
        .bind(input.dispatchId, input.jobId, input.revisionId, input.now, input.now, input.now, input.jobId, input.ownerId),
    ]);
    if (statements[0].meta.changes === 1) return { jobId: input.jobId, idempotent: false };
    const raced = await db.prepare("SELECT id, input_kind, request_json, image_model FROM jobs WHERE owner_id = ? AND idempotency_key = ?")
      .bind(input.ownerId, input.idempotencyKey).first<JobRow>();
    if (raced && raced.input_kind === input.inputKind && raced.request_json === input.requestJson && raced.image_model === input.imageModel) return { jobId: raced.id, idempotent: true };
    if (raced) throw new JobCommandError("CONFLICT");
    throw new JobCommandError("SERVICE_UNAVAILABLE");
  }
  if (input.command === "workflowRead") {
    const job = await db.prepare("SELECT request_json, image_model, status FROM jobs WHERE id = ?").bind(input.jobId).first<JobRow>();
    if (!job) throw new JobCommandError("NOT_FOUND");
    return { job };
  }
  if (input.command === "workflowComplete") {
    const job = await db.prepare("SELECT status FROM jobs WHERE id = ?").bind(input.jobId).first<{ status: string }>();
    if (!job) throw new JobCommandError("NOT_FOUND");
    if (job.status === "cancelling" || job.status === "cancelled" || job.status === "deleting" || job.status === "deleted") return { completed: false };
    if (job.status === "failed") return { completed: false };
    if (job.status !== "completed") {
      const result = await db.batch([
        db.prepare("UPDATE jobs SET status = 'completed', current_stage = NULL, error_code = NULL, updated_at = ? WHERE id = ? AND status IN ('queued', 'running')").bind(input.now, input.jobId),
        db.prepare("UPDATE job_revisions SET status = 'completed', completed_at = ? WHERE id = ? AND job_id = ? AND status IN ('queued', 'running')").bind(input.now, input.revisionId, input.jobId),
      ]);
      if (result[0].meta.changes !== 1) throw new JobCommandError("CONFLICT");
    }
    return { completed: true };
  }
  if (input.command === "workflowFail") {
    const job = await db.prepare("SELECT status FROM jobs WHERE id = ?").bind(input.jobId).first<{ status: string }>();
    if (!job) throw new JobCommandError("NOT_FOUND");
    if (["completed", "failed", "cancelled", "deleting", "deleted"].includes(job.status)) return { failed: false };
    const retrying = await db.prepare("SELECT id FROM stage_runs WHERE job_id = ? AND status = 'pending' AND attempt > 0 LIMIT 1").bind(input.jobId).first();
    if (retrying) return { failed: false, retrying: true };
    if (job.status === "cancelling") return { failed: false, cancelled: await settleCancellation(db, input.jobId, input.now) };
    const result = await db.batch([
      db.prepare("UPDATE usage_events SET charge_state = 'ambiguous', actual_cost_units = estimated_cost_units WHERE job_id = ? AND charge_state = 'reserved'").bind(input.jobId),
      db.prepare("UPDATE jobs SET status = 'failed', error_code = 'workflow_failed', current_stage = NULL, updated_at = ? WHERE id = ? AND status IN ('queued', 'running')").bind(input.now, input.jobId),
      db.prepare("UPDATE job_revisions SET status = 'failed', completed_at = ? WHERE job_id = ? AND status IN ('queued', 'running')").bind(input.now, input.jobId),
      db.prepare("UPDATE quota_reservations SET confirmed_image_calls = COALESCE((SELECT SUM(CASE WHEN charge_state IN ('confirmed', 'ambiguous') THEN image_count ELSE 0 END) FROM usage_events WHERE job_id = ?), 0), confirmed_cost_units = COALESCE((SELECT SUM(CASE WHEN charge_state IN ('confirmed', 'ambiguous') THEN actual_cost_units ELSE 0 END) FROM usage_events WHERE job_id = ?), 0), reserved_image_calls = COALESCE((SELECT SUM(CASE WHEN charge_state IN ('confirmed', 'ambiguous') THEN image_count ELSE 0 END) FROM usage_events WHERE job_id = ?), 0), reserved_cost_units = COALESCE((SELECT SUM(CASE WHEN charge_state IN ('confirmed', 'ambiguous') THEN actual_cost_units ELSE 0 END) FROM usage_events WHERE job_id = ?), 0), inflight_image_calls = 0, inflight_cost_units = 0, charge_state = CASE WHEN EXISTS (SELECT 1 FROM usage_events WHERE job_id = ? AND charge_state = 'ambiguous') THEN 'ambiguous' WHEN COALESCE((SELECT SUM(CASE WHEN charge_state IN ('confirmed', 'ambiguous') THEN actual_cost_units ELSE 0 END) FROM usage_events WHERE job_id = ?), 0) = 0 THEN 'released' ELSE 'confirmed' END, released_at = ? WHERE job_id = ?").bind(input.jobId, input.jobId, input.jobId, input.jobId, input.jobId, input.jobId, input.now, input.jobId),
    ]);
    if (result[1].meta.changes !== 1) throw new JobCommandError("CONFLICT");
    return { failed: true };
  }
  if (input.command === "list") {
    const rows = await db.prepare("SELECT id, status, current_stage, active_revision_number, error_code FROM jobs WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50")
      .bind(input.ownerId).all<JobRow>();
    return { jobs: rows.results };
  }

  const job = await ownedJob(db, input.ownerId, input.jobId);
  if (!job) throw new JobCommandError("NOT_FOUND");
  if (input.command === "read") {
    const revision = await db.prepare("SELECT id, revision_number, status FROM job_revisions WHERE job_id = ? AND revision_number = ?")
      .bind(input.jobId, job.active_revision_number).first<JobRow>();
    if (!revision) throw new JobCommandError("NOT_FOUND");
    const [stages, artifacts] = await db.batch([
      db.prepare("SELECT stage, status, attempt, slide_number, started_at, completed_at, input_artifact_ids_json, output_artifact_ids_json, validator, model, usage_json, retry_reason, error_code FROM stage_runs WHERE job_id = ? AND revision_id = ? ORDER BY created_at").bind(input.jobId, revision.id),
      db.prepare("SELECT id, kind, lifecycle, storage_path, media_type, byte_size, sha256, slide_number FROM artifacts WHERE job_id = ? AND revision_id = ? AND lifecycle = 'final' ORDER BY created_at").bind(input.jobId, revision.id),
    ]);
    return { job, revision, stages: stages.results, artifacts: artifacts.results };
  }

  if (input.command === "cancel") {
    if (job.status === "queued") {
      await db.batch([
        db.prepare("UPDATE jobs SET status = 'cancelled', current_stage = NULL, updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'queued'").bind(input.now, input.jobId, input.ownerId),
        db.prepare("UPDATE workflow_dispatches SET status = 'cancelled', updated_at = ? WHERE job_id = ? AND status = 'pending'").bind(input.now, input.jobId),
      ]);
      return { status: "cancelled" };
    }
    if (job.status === "running") {
      await db.prepare("UPDATE jobs SET status = 'cancelling', updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'running'")
        .bind(input.now, input.jobId, input.ownerId).run();
      return { status: "cancelling" };
    }
    throw new JobCommandError("CONFLICT");
  }

  if (job.status === "running" || job.status === "cancelling" || job.status === "deleted" || job.status === "deleting") throw new JobCommandError("CONFLICT");
  await db.prepare("UPDATE jobs SET status = 'deleting', deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL")
    .bind(input.now, input.now, input.jobId, input.ownerId).run();
  return { status: "deleting" };
}
