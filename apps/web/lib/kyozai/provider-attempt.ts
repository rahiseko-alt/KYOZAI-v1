import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";

import { createServerSupabaseClient } from "../supabase/server";
import { cloudflareStateEnabled, sendControlPlaneCommand } from "./control-plane-client";
import { readPrivateControlPlaneArtifact, writePrivateControlPlaneArtifact } from "./control-plane-artifacts";
import { injectG1Fault } from "./g1-fault-injection";

const ARTIFACT_BUCKET = "kyozai-artifacts";

export type ProviderOperation = "text_generation" | "image_generation" | "image_qa";
export type ProviderAttemptContext = {
  jobId: string;
  revisionId: string;
  stageRunId: string;
  stage: string;
  slideNumber: number;
};
export type ProviderAttemptInput = {
  operation: ProviderOperation;
  provider: string;
  model: string;
  logicalAttempt: string;
  imageCount?: number;
  estimatedCostUnits?: number;
};
export type ProviderAttempt = {
  tracked: true;
  context: ProviderAttemptContext;
  input: ProviderAttemptInput;
  fingerprint: string;
  checkpointPath: string;
  recovered?: Buffer;
} | { tracked: false };

type ReservationRow = {
  charge_state: "reserved" | "confirmed" | "ambiguous" | "released";
  result_storage_path?: string | null;
  result_sha256?: string | null;
  result_byte_size?: number | null;
  should_call: boolean;
};

const contextStorage = new AsyncLocalStorage<ProviderAttemptContext>();

function hash(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function checkpointPath(context: ProviderAttemptContext, fingerprint: string) {
  return `${context.jobId}/${context.revisionId}/provider-results/${fingerprint}.json`;
}

function checkpointArtifactId(fingerprint: string) {
  return `provider-checkpoint-${fingerprint}`;
}

function reservationRow(value: unknown): ReservationRow | undefined {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return undefined;
  const candidate = row as Record<string, unknown>;
  const shouldCall = candidate.should_call ?? candidate.shouldCall;
  if (!(["reserved", "confirmed", "ambiguous", "released"] as unknown[]).includes(candidate.charge_state)
    || typeof shouldCall !== "boolean") return undefined;
  return { ...candidate, should_call: shouldCall } as ReservationRow;
}

async function readCheckpoint(path: string, expectedHash?: string | null, expectedBytes?: number | null, artifactId?: string) {
  if (cloudflareStateEnabled()) {
    try {
      const artifact = await readPrivateControlPlaneArtifact(artifactId ?? checkpointArtifactId(path));
      const bytes = artifact.bytes;
      if ((expectedBytes != null && bytes.length !== Number(expectedBytes))
        || (expectedHash && hash(bytes) !== expectedHash)) throw new Error("provider_checkpoint_integrity_failed");
      return bytes;
    } catch (error) {
      if (error instanceof Error && error.message === "provider_checkpoint_integrity_failed") throw error;
      return undefined;
    }
  }
  const { data, error } = await createServerSupabaseClient().storage.from(ARTIFACT_BUCKET).download(path);
  if (error || !data) return undefined;
  const bytes = Buffer.from(await data.arrayBuffer());
  if ((expectedBytes != null && bytes.length !== Number(expectedBytes))
    || (expectedHash && hash(bytes) !== expectedHash)) throw new Error("provider_checkpoint_integrity_failed");
  return bytes;
}

async function settle(attempt: Extract<ProviderAttempt, { tracked: true }>, chargeState: "confirmed" | "ambiguous" | "released", checkpoint?: Buffer) {
  if (cloudflareStateEnabled()) {
    const result = await sendControlPlaneCommand<{ settled: boolean }>("providers", {
      command: "settle", jobId: attempt.context.jobId, requestFingerprint: attempt.fingerprint, chargeState,
      ...(checkpoint ? { resultStoragePath: attempt.checkpointPath, resultSha256: hash(checkpoint), resultByteSize: checkpoint.length } : {}),
    });
    if (!result.settled) throw new Error("provider_attempt_settlement_failed");
    return;
  }
  const { data, error } = await createServerSupabaseClient().rpc("settle_kyozai_provider_attempt", {
    p_job_id: attempt.context.jobId,
    p_request_fingerprint: attempt.fingerprint,
    p_charge_state: chargeState,
    p_result_storage_path: checkpoint ? attempt.checkpointPath : null,
    p_result_sha256: checkpoint ? hash(checkpoint) : null,
    p_result_byte_size: checkpoint?.length ?? null,
  });
  if (error || data !== true) throw new Error("provider_attempt_settlement_failed");
}

export function withProviderAttemptContext<T>(context: ProviderAttemptContext, callback: () => Promise<T>) {
  return contextStorage.run(context, callback);
}

export async function beginProviderAttempt(input: ProviderAttemptInput): Promise<ProviderAttempt> {
  const context = contextStorage.getStore();
  if (!context) return { tracked: false };
  const fingerprint = hash(JSON.stringify({
    jobId: context.jobId,
    revisionId: context.revisionId,
    stage: context.stage,
    slideNumber: context.slideNumber,
    operation: input.operation,
    provider: input.provider,
    model: input.model,
    logicalAttempt: input.logicalAttempt,
  }));
  const path = checkpointPath(context, fingerprint);
  let reservation: ReservationRow | undefined;
  if (cloudflareStateEnabled()) {
    reservation = reservationRow(await sendControlPlaneCommand("providers", {
      command: "reserve", usageEventId: randomUUID(), jobId: context.jobId, revisionId: context.revisionId,
      stageRunId: context.stageRunId, operation: input.operation, provider: input.provider, model: input.model,
      requestFingerprint: fingerprint, imageCount: input.imageCount ?? 0, costUnits: input.estimatedCostUnits ?? 1,
      now: new Date().toISOString(),
    }));
  } else {
    const { data, error } = await createServerSupabaseClient().rpc("reserve_kyozai_provider_attempt", {
      p_job_id: context.jobId, p_revision_id: context.revisionId, p_stage_run_id: context.stageRunId,
      p_operation: input.operation, p_provider: input.provider, p_model: input.model,
      p_request_fingerprint: fingerprint, p_image_count: input.imageCount ?? 0, p_cost_units: input.estimatedCostUnits ?? 1,
    });
    if (!error) reservation = reservationRow(data);
  }
  if (!reservation) throw new Error("provider_attempt_reservation_failed");
  const attempt = { tracked: true, context, input, fingerprint, checkpointPath: path } as Extract<ProviderAttempt, { tracked: true }>;
  if (reservation.should_call) return attempt;

  const recovered = await readCheckpoint(
    reservation.result_storage_path ?? path,
    reservation.result_sha256,
    reservation.result_byte_size,
    checkpointArtifactId(fingerprint),
  );
  if (recovered) {
    if (reservation.charge_state === "reserved") await settle(attempt, "confirmed", recovered);
    return { ...attempt, recovered };
  }
  if (reservation.charge_state === "reserved") await settle(attempt, "ambiguous");
  throw new Error(`provider_result_unavailable:${reservation.charge_state}`);
}

export async function confirmProviderAttempt(attempt: ProviderAttempt, checkpoint: Buffer) {
  if (!attempt.tracked) return;
  if (cloudflareStateEnabled()) {
    try {
      await writePrivateControlPlaneArtifact({ artifactId: checkpointArtifactId(attempt.fingerprint), jobId: attempt.context.jobId, revisionId: attempt.context.revisionId, kind: "provider_checkpoint", storageBucket: ARTIFACT_BUCKET, storagePath: attempt.checkpointPath, mediaType: "application/json", bytes: checkpoint, metadata: { requestFingerprint: attempt.fingerprint }, now: new Date().toISOString() });
    } catch {
      const existing = await readCheckpoint(attempt.checkpointPath, hash(checkpoint), checkpoint.length, checkpointArtifactId(attempt.fingerprint));
      if (!existing) throw new Error("provider_checkpoint_upload_failed");
    }
    injectG1Fault("provider_checkpoint_saved");
    await settle(attempt, "confirmed", checkpoint);
    return;
  }
  const storage = createServerSupabaseClient().storage.from(ARTIFACT_BUCKET);
  const uploaded = await storage.upload(attempt.checkpointPath, checkpoint, { contentType: "application/json", upsert: false });
  if (uploaded.error) {
    const existing = await readCheckpoint(attempt.checkpointPath);
    if (!existing || existing.length !== checkpoint.length || hash(existing) !== hash(checkpoint)) {
      throw new Error("provider_checkpoint_upload_failed");
    }
  }
  const persisted = await readCheckpoint(attempt.checkpointPath, hash(checkpoint), checkpoint.length);
  if (!persisted) throw new Error("provider_checkpoint_readback_failed");
  injectG1Fault("provider_checkpoint_saved");
  await settle(attempt, "confirmed", checkpoint);
}

export async function markProviderAttemptAmbiguous(attempt: ProviderAttempt) {
  if (attempt.tracked) await settle(attempt, "ambiguous");
}

export async function releaseProviderAttempt(attempt: ProviderAttempt) {
  if (attempt.tracked) await settle(attempt, "released");
}
