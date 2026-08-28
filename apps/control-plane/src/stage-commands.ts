export type StageCommand = { command: "claim"; stageRunId: string; leaseOwner: string; leaseSeconds: number; now: string; leaseExpiresAt: string };

export class StageCommandError extends Error {
  constructor(readonly code: "BAD_COMMAND" | "CONFLICT") { super(code); }
}

function text(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) throw new StageCommandError("BAD_COMMAND");
  return value.trim();
}

export function parseStageCommand(value: unknown): StageCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StageCommandError("BAD_COMMAND");
  const input = value as Record<string, unknown>;
  if (input.command !== "claim" || typeof input.leaseSeconds !== "number" || !Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 15 || input.leaseSeconds > 900) throw new StageCommandError("BAD_COMMAND");
  return { command: "claim", stageRunId: text(input.stageRunId), leaseOwner: text(input.leaseOwner), leaseSeconds: input.leaseSeconds, now: text(input.now), leaseExpiresAt: text(input.leaseExpiresAt) };
}

/** Claims only a pending or expired lease; the batch keeps stage and job state atomic. */
export async function executeStageCommand(db: D1Database, input: StageCommand) {
  const result = await db.batch([
    db.prepare("UPDATE stage_runs SET status = 'running', lease_owner = ?, lease_expires_at = ?, started_at = COALESCE(started_at, ?) WHERE id = ? AND (status = 'pending' OR (status = 'running' AND lease_expires_at < ?)) AND EXISTS (SELECT 1 FROM jobs WHERE jobs.id = stage_runs.job_id AND jobs.status IN ('queued', 'running'))")
      .bind(input.leaseOwner, input.leaseExpiresAt, input.now, input.stageRunId, input.now),
    db.prepare("UPDATE jobs SET status = 'running', current_stage = (SELECT stage FROM stage_runs WHERE id = ?), updated_at = ? WHERE id = (SELECT job_id FROM stage_runs WHERE id = ? AND status = 'running' AND lease_owner = ?)")
      .bind(input.stageRunId, input.now, input.stageRunId, input.leaseOwner),
  ]);
  if (result[0].meta.changes !== 1) throw new StageCommandError("CONFLICT");
  const stage = await db.prepare("SELECT id, job_id, revision_id, stage, slide_number, attempt, lease_expires_at FROM stage_runs WHERE id = ? AND status = 'running' AND lease_owner = ?")
    .bind(input.stageRunId, input.leaseOwner).first();
  if (!stage) throw new StageCommandError("CONFLICT");
  return { stage };
}
