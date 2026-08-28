type Row = Record<string, unknown>;

export type StageCommand =
  | { command: "claim"; stageRunId: string; leaseOwner: string; leaseSeconds: number; now: string; leaseExpiresAt: string }
  | { command: "pass"; stageRunId: string; leaseOwner: string; outputArtifactIds: string[]; validator: string; usageJson: string; now: string }
  | { command: "fail"; stageRunId: string; leaseOwner: string; errorCode: string; retry: boolean; retryStageRunId?: string; retryReason?: string; now: string };

export class StageCommandError extends Error { constructor(readonly code: "BAD_COMMAND" | "CONFLICT") { super(code); } }
const text = (value: unknown) => { if (typeof value !== "string" || !value.trim() || value.length > 512) throw new StageCommandError("BAD_COMMAND"); return value.trim(); };
const ids = (value: unknown) => { if (!Array.isArray(value) || value.length > 50 || value.some((x) => typeof x !== "string" || !x.trim())) throw new StageCommandError("BAD_COMMAND"); return value.map((x) => x.trim()); };

export function parseStageCommand(value: unknown): StageCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StageCommandError("BAD_COMMAND");
  const x = value as Record<string, unknown>;
  if (x.command === "claim") { if (typeof x.leaseSeconds !== "number" || !Number.isInteger(x.leaseSeconds) || x.leaseSeconds < 15 || x.leaseSeconds > 900) throw new StageCommandError("BAD_COMMAND"); return { command: "claim", stageRunId: text(x.stageRunId), leaseOwner: text(x.leaseOwner), leaseSeconds: x.leaseSeconds, now: text(x.now), leaseExpiresAt: text(x.leaseExpiresAt) }; }
  if (x.command === "pass") { const usageJson = text(x.usageJson); try { JSON.parse(usageJson); } catch { throw new StageCommandError("BAD_COMMAND"); } return { command: "pass", stageRunId: text(x.stageRunId), leaseOwner: text(x.leaseOwner), outputArtifactIds: ids(x.outputArtifactIds), validator: text(x.validator), usageJson, now: text(x.now) }; }
  if (x.command === "fail") { if (typeof x.retry !== "boolean") throw new StageCommandError("BAD_COMMAND"); const retryStageRunId = x.retryStageRunId === undefined ? undefined : text(x.retryStageRunId); if (x.retry && !retryStageRunId) throw new StageCommandError("BAD_COMMAND"); return { command: "fail", stageRunId: text(x.stageRunId), leaseOwner: text(x.leaseOwner), errorCode: text(x.errorCode), retry: x.retry, retryStageRunId, retryReason: x.retryReason === undefined ? undefined : text(x.retryReason), now: text(x.now) }; }
  throw new StageCommandError("BAD_COMMAND");
}

async function active(db: D1Database, id: string, owner: string, now: string) {
  const row = await db.prepare("SELECT s.id, s.job_id, s.revision_id, s.stage, s.slide_number, s.attempt, s.input_artifact_ids_json, s.validator, j.status AS job_status FROM stage_runs s JOIN jobs j ON j.id = s.job_id WHERE s.id = ? AND s.status = 'running' AND s.lease_owner = ? AND s.lease_expires_at > ?").bind(id, owner, now).first<Row>();
  if (!row) throw new StageCommandError("CONFLICT"); return row;
}

async function claim(db: D1Database, x: Extract<StageCommand, { command: "claim" }>) {
  const out = await db.batch([db.prepare("UPDATE stage_runs SET status = 'running', lease_owner = ?, lease_expires_at = ?, started_at = COALESCE(started_at, ?) WHERE id = ? AND (status = 'pending' OR (status = 'running' AND lease_expires_at < ?)) AND EXISTS (SELECT 1 FROM jobs WHERE jobs.id = stage_runs.job_id AND jobs.status IN ('queued', 'running'))").bind(x.leaseOwner, x.leaseExpiresAt, x.now, x.stageRunId, x.now), db.prepare("UPDATE jobs SET status = 'running', current_stage = (SELECT stage FROM stage_runs WHERE id = ?), updated_at = ? WHERE id = (SELECT job_id FROM stage_runs WHERE id = ? AND status = 'running' AND lease_owner = ?)").bind(x.stageRunId, x.now, x.stageRunId, x.leaseOwner)]);
  if (out[0].meta.changes !== 1) throw new StageCommandError("CONFLICT"); return { stage: await db.prepare("SELECT id, job_id, revision_id, stage, slide_number, attempt, lease_expires_at FROM stage_runs WHERE id = ? AND lease_owner = ?").bind(x.stageRunId, x.leaseOwner).first() };
}

async function pass(db: D1Database, x: Extract<StageCommand, { command: "pass" }>) {
  const row = await active(db, x.stageRunId, x.leaseOwner, x.now);
  if (x.outputArtifactIds.length) {
    const placeholders = x.outputArtifactIds.map(() => "?").join(", ");
    const owned = await db.prepare(`SELECT COUNT(*) AS count FROM artifacts WHERE id IN (${placeholders}) AND job_id = ? AND revision_id = ? AND lifecycle IN ('draft', 'validated', 'final')`).bind(...x.outputArtifactIds, row.job_id, row.revision_id).first<{ count: number }>();
    if (Number(owned?.count) !== x.outputArtifactIds.length) throw new StageCommandError("CONFLICT");
  }
  const result = await db.batch([db.prepare("UPDATE stage_runs SET status = CASE WHEN (SELECT status FROM jobs WHERE id = ?) = 'cancelling' THEN 'skipped' ELSE 'passed' END, output_artifact_ids_json = ?, validator = ?, usage_json = ?, completed_at = ?, lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_expires_at > ?").bind(row.job_id, JSON.stringify(x.outputArtifactIds), x.validator, x.usageJson, x.now, x.stageRunId, x.leaseOwner, x.now), db.prepare("UPDATE jobs SET status = 'cancelled', current_stage = NULL, updated_at = ? WHERE id = ? AND status = 'cancelling' AND NOT EXISTS (SELECT 1 FROM stage_runs WHERE job_id = ? AND status = 'running')").bind(x.now, row.job_id, row.job_id)]);
  if (result[0].meta.changes !== 1) throw new StageCommandError("CONFLICT"); const done = await db.prepare("SELECT status FROM stage_runs WHERE id = ?").bind(x.stageRunId).first<{ status: string }>(); return { passed: done?.status === "passed" };
}

async function fail(db: D1Database, x: Extract<StageCommand, { command: "fail" }>) {
  const row = await active(db, x.stageRunId, x.leaseOwner, x.now); const retry = x.retry && Number(row.attempt) < 1 && row.job_status !== "cancelling"; const result = await db.batch([db.prepare("UPDATE stage_runs SET status = 'failed', error_code = ?, retry_reason = ?, completed_at = ?, lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_expires_at > ?").bind(x.errorCode, x.retryReason ?? null, x.now, x.stageRunId, x.leaseOwner, x.now), ...(retry ? [db.prepare("INSERT INTO stage_runs (id, job_id, revision_id, stage, slide_number, attempt, status, input_artifact_ids_json, validator, retry_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)").bind(x.retryStageRunId, row.job_id, row.revision_id, row.stage, row.slide_number, Number(row.attempt) + 1, row.input_artifact_ids_json, row.validator, x.retryReason ?? null, x.now)] : []), db.prepare("UPDATE jobs SET status = CASE WHEN status = 'cancelling' THEN 'cancelled' ELSE 'failed' END, current_stage = NULL, error_code = CASE WHEN status = 'cancelling' THEN error_code ELSE ? END, updated_at = ? WHERE id = ? AND status IN ('running', 'cancelling') AND ? = 0").bind(x.errorCode, x.now, row.job_id, retry ? 1 : 0)]);
  if (result[0].meta.changes !== 1) throw new StageCommandError("CONFLICT"); return { retryStageRunId: retry ? x.retryStageRunId : undefined };
}

export async function executeStageCommand(db: D1Database, x: StageCommand) { if (x.command === "claim") return claim(db, x); if (x.command === "pass") return pass(db, x); return fail(db, x); }
