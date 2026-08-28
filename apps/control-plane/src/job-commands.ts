type JobRow = Record<string, unknown>;

export type JobCommand =
  | { command: "list"; ownerId: string }
  | { command: "read"; ownerId: string; jobId: string }
  | { command: "cancel"; ownerId: string; jobId: string; now: string }
  | { command: "delete"; ownerId: string; jobId: string; now: string };

export class JobCommandError extends Error {
  constructor(readonly code: "BAD_COMMAND" | "NOT_FOUND" | "CONFLICT") {
    super(code);
  }
}

function requiredText(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) throw new JobCommandError("BAD_COMMAND");
  return value.trim();
}

function commandName(value: unknown) {
  if (value === "list" || value === "read" || value === "cancel" || value === "delete") return value;
  throw new JobCommandError("BAD_COMMAND");
}

export function parseJobCommand(value: unknown): JobCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new JobCommandError("BAD_COMMAND");
  const input = value as Record<string, unknown>;
  const command = commandName(input.command);
  const ownerId = requiredText(input.ownerId, "ownerId");
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

export async function executeJobCommand(db: D1Database, input: JobCommand) {
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
