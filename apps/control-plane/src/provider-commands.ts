type ProviderChargeState = "reserved" | "confirmed" | "ambiguous" | "released";
type ProviderOperation = "text_generation" | "image_generation" | "image_qa";
type UsageRow = { charge_state: ProviderChargeState; result_storage_path: string | null; result_sha256: string | null; result_byte_size: number | null };

export type ProviderCommand =
  | { command: "reserve"; usageEventId: string; jobId: string; revisionId: string; stageRunId: string; operation: ProviderOperation; provider: string; model: string; requestFingerprint: string; imageCount: number; costUnits: number; now: string }
  | { command: "settle"; jobId: string; requestFingerprint: string; chargeState: "confirmed" | "ambiguous" | "released"; resultStoragePath?: string; resultSha256?: string; resultByteSize?: number };

export class ProviderCommandError extends Error { constructor(readonly code: "BAD_COMMAND" | "CONFLICT") { super(code); } }
const text = (value: unknown) => { if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new ProviderCommandError("BAD_COMMAND"); return value.trim(); };
const amount = (value: unknown) => { if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new ProviderCommandError("BAD_COMMAND"); return value; };

export function parseProviderCommand(value: unknown): ProviderCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProviderCommandError("BAD_COMMAND");
  const x = value as Record<string, unknown>;
  if (x.command === "reserve") {
    const operation = x.operation;
    if (operation !== "text_generation" && operation !== "image_generation" && operation !== "image_qa") throw new ProviderCommandError("BAD_COMMAND");
    return { command: "reserve", usageEventId: text(x.usageEventId), jobId: text(x.jobId), revisionId: text(x.revisionId), stageRunId: text(x.stageRunId), operation, provider: text(x.provider), model: text(x.model), requestFingerprint: text(x.requestFingerprint), imageCount: amount(x.imageCount), costUnits: amount(x.costUnits), now: text(x.now) };
  }
  if (x.command !== "settle" || (x.chargeState !== "confirmed" && x.chargeState !== "ambiguous" && x.chargeState !== "released")) throw new ProviderCommandError("BAD_COMMAND");
  const resultStoragePath = x.resultStoragePath === undefined ? undefined : text(x.resultStoragePath);
  const resultSha256 = x.resultSha256 === undefined ? undefined : text(x.resultSha256).toLowerCase();
  const resultByteSize = x.resultByteSize === undefined ? undefined : amount(x.resultByteSize);
  if (x.chargeState === "confirmed" && (!resultStoragePath || !resultSha256 || !/^[a-f0-9]{64}$/.test(resultSha256) || !resultByteSize)) throw new ProviderCommandError("BAD_COMMAND");
  if (x.chargeState !== "confirmed" && (resultStoragePath !== undefined || resultSha256 !== undefined || resultByteSize !== undefined)) throw new ProviderCommandError("BAD_COMMAND");
  return { command: "settle", jobId: text(x.jobId), requestFingerprint: text(x.requestFingerprint), chargeState: x.chargeState, resultStoragePath, resultSha256, resultByteSize };
}

export async function executeProviderCommand(db: D1Database, command: ProviderCommand) {
  if (command.command === "reserve") {
    const existing = await db.prepare("SELECT charge_state, result_storage_path, result_sha256, result_byte_size FROM usage_events WHERE job_id = ? AND request_fingerprint = ?").bind(command.jobId, command.requestFingerprint).first<UsageRow>();
    if (existing) return { ...existing, shouldCall: false };
    try {
      await db.prepare("INSERT INTO usage_events (id, job_id, revision_id, stage_run_id, operation, provider, model, request_fingerprint, image_count, estimated_cost_units, charge_state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?)").bind(command.usageEventId, command.jobId, command.revisionId, command.stageRunId, command.operation, command.provider, command.model, command.requestFingerprint, command.imageCount, command.costUnits, command.now).run();
      return { charge_state: "reserved" as const, result_storage_path: null, result_sha256: null, result_byte_size: null, shouldCall: true };
    } catch (error) {
      if (error instanceof ProviderCommandError) throw error;
      const raced = await db.prepare("SELECT charge_state, result_storage_path, result_sha256, result_byte_size FROM usage_events WHERE job_id = ? AND request_fingerprint = ?").bind(command.jobId, command.requestFingerprint).first<UsageRow>();
      if (raced) return { ...raced, shouldCall: false };
      throw new ProviderCommandError("CONFLICT");
    }
  }
  const usage = await db.prepare("SELECT id, charge_state FROM usage_events WHERE job_id = ? AND request_fingerprint = ?").bind(command.jobId, command.requestFingerprint).first<{ id: string; charge_state: ProviderChargeState }>();
  if (!usage) throw new ProviderCommandError("CONFLICT");
  if (usage.charge_state !== "reserved") return { settled: true };
  const costRow = await db.prepare("SELECT estimated_cost_units FROM usage_events WHERE id = ?").bind(usage.id).first() as { estimated_cost_units?: unknown } | null;
  const actualCost = command.chargeState === "released" ? 0 : typeof costRow?.estimated_cost_units === "number" ? costRow.estimated_cost_units : undefined;
  if (actualCost === undefined) throw new ProviderCommandError("CONFLICT");
  await db.prepare("UPDATE usage_events SET charge_state = ?, actual_cost_units = ?, result_storage_path = ?, result_sha256 = ?, result_byte_size = ? WHERE id = ? AND charge_state = 'reserved'").bind(command.chargeState, actualCost, command.chargeState === "confirmed" ? command.resultStoragePath : null, command.chargeState === "confirmed" ? command.resultSha256 : null, command.chargeState === "confirmed" ? command.resultByteSize : null, usage.id).run();
  const settled = await db.prepare("SELECT charge_state FROM usage_events WHERE id = ?").bind(usage.id).first<{ charge_state: ProviderChargeState }>();
  if (!settled || settled.charge_state !== command.chargeState) throw new ProviderCommandError("CONFLICT");
  return { settled: true };
}
