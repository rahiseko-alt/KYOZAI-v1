import { createHash, randomUUID } from "node:crypto";

import { isKyozaiJobStage, type ArtifactManifestEntry, type StageLedgerEntry } from "../../../../shared/kyozai-job-contract";

import { createServerSupabaseClient } from "../supabase/server";
import { cloudflareStateEnabled, sendControlPlaneJobCommand } from "./control-plane-client";
import { parsedObject, stringArray } from "./job-store-values";
import { assertSafePdf, PdfInputError, pdfLimits } from "./pdf-safety";
import { badRequest, conflict, payloadTooLarge, PublicHttpError, routeUnavailable } from "./http-errors";
import type { AuthenticatedJobUser } from "./job-auth";
import type { KyozaiJobSnapshot } from "./job-client";
import { planRevision, type RevisionPlan } from "./revision-plan";

const SOURCE_BUCKET = "kyozai-sources";
const ARTIFACT_BUCKET = "kyozai-artifacts";
const MAX_UPLOADS = 2;
const MAX_UPLOAD_TOTAL_BYTES = 25 * 1024 * 1024;
const UPLOAD_TTL_SECONDS = 60 * 60;
const allowedMediaTypes = new Set(["application/pdf", "text/plain", "text/markdown"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type UploadRequest = { filename: string; mediaType: string; byteSize: number };
export type CreateJobRequest = {
  request: string;
  imageModel: string;
  sourceText?: string;
  sourceUrl?: string;
  attachmentIds?: string[];
};

function assertUuid(value: string, message: string) {
  if (!uuid.test(value)) throw badRequest(message);
}

function extension(filename: string, mediaType: string) {
  const candidate = filename.toLowerCase().match(/\.(pdf|txt|md|markdown)$/)?.[1];
  if (candidate) return candidate === "markdown" ? "md" : candidate;
  return mediaType === "application/pdf" ? "pdf" : mediaType === "text/markdown" ? "md" : "txt";
}

function classifyInput(request: CreateJobRequest): "text" | "url" | "attachments" | "mixed" {
  const count = Number(Boolean(request.sourceText?.trim())) + Number(Boolean(request.sourceUrl?.trim())) + Number((request.attachmentIds?.length ?? 0) > 0);
  if (count > 1) return "mixed";
  if (request.sourceText?.trim()) return "text";
  if (request.sourceUrl?.trim()) return "url";
  return "attachments";
}

function validateCreateRequest(value: CreateJobRequest): Required<Pick<CreateJobRequest, "request" | "imageModel">> & CreateJobRequest {
  const request = value.request?.trim();
  if (!request || request.length < 8 || request.length > 1000) throw badRequest("教材への要望を8〜1000文字で入力してください。");
  const imageModel = value.imageModel?.trim();
  if (!imageModel || imageModel.length > 120) throw badRequest("画像モデルを選択してください。");
  const sourceText = value.sourceText?.trim();
  const sourceUrl = value.sourceUrl?.trim();
  if (sourceText && sourceText.length > 80_000) throw payloadTooLarge("直接入力は80,000文字以下にしてください。");
  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      if (parsed.protocol !== "https:") throw new Error("protocol");
    } catch { throw badRequest("URLはHTTPSの公開URLを指定してください。"); }
  }
  const attachmentIds = value.attachmentIds ?? [];
  if (!Array.isArray(attachmentIds) || attachmentIds.length > MAX_UPLOADS || attachmentIds.some((id) => typeof id !== "string")) {
    throw badRequest("添付ファイルは最大2件です。");
  }
  attachmentIds.forEach((id) => assertUuid(id, "添付ファイルを確認できません。"));
  if (!sourceText && !sourceUrl && attachmentIds.length === 0) throw badRequest("資料、URL、またはテキストを1つ以上追加してください。");
  return { ...value, request, imageModel, sourceText, sourceUrl, attachmentIds };
}

export async function createUpload(user: AuthenticatedJobUser, input: UploadRequest) {
  if (!allowedMediaTypes.has(input.mediaType)) throw badRequest("PDF・TXT・Markdownのみアップロードできます。");
  if (!Number.isInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > MAX_UPLOAD_TOTAL_BYTES) {
    throw payloadTooLarge("添付ファイルの合計は25MiB以下にしてください。");
  }
  const supabase = createServerSupabaseClient();
  const { data: sessions, error: sessionsError } = await supabase
    .from("upload_sessions")
    .select("id, byte_limit")
    .eq("owner_id", user.id)
    .is("consumed_by_job_id", null)
    .gt("expires_at", new Date().toISOString());
  if (sessionsError) throw new Error("upload_session_query_failed");
  const existing = sessions ?? [];
  const usedBytes = existing.reduce((sum, item) => sum + Number(item.byte_limit ?? 0), 0);
  if (existing.length >= MAX_UPLOADS || usedBytes + input.byteSize > MAX_UPLOAD_TOTAL_BYTES) {
    throw payloadTooLarge("添付ファイルは最大2件、合計25MiBまでです。");
  }

  const id = randomUUID();
  const path = `${user.id}/${id}/original.${extension(input.filename, input.mediaType)}`;
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString();
  const { error: insertError } = await supabase.from("upload_sessions").insert({
    id, owner_id: user.id, storage_path: path, media_type: input.mediaType, byte_limit: input.byteSize, expires_at: expiresAt,
  });
  if (insertError) throw new Error("upload_session_create_failed");
  const { data, error } = await supabase.storage.from(SOURCE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    await supabase.from("upload_sessions").delete().eq("id", id).eq("owner_id", user.id);
    throw new Error("upload_url_create_failed");
  }
  return { attachmentId: id, uploadUrl: data.signedUrl, expiresAt };
}

async function finalizeUploads(user: AuthenticatedJobUser, attachmentIds: string[]) {
  if (attachmentIds.length === 0) return;
  const supabase = createServerSupabaseClient();
  const { data: sessions, error } = await supabase.from("upload_sessions")
    .select("id, storage_path, media_type, byte_limit, consumed_by_job_id, expires_at")
    .eq("owner_id", user.id).in("id", attachmentIds);
  if (error || !sessions || sessions.length !== attachmentIds.length) throw badRequest("添付ファイルを確認できません。再アップロードしてください。");
  for (const session of sessions) {
    if (session.consumed_by_job_id || new Date(session.expires_at).getTime() <= Date.now()) throw badRequest("添付ファイルの有効期限が切れています。再アップロードしてください。");
    const { data: blob, error: downloadError } = await supabase.storage.from(SOURCE_BUCKET).download(session.storage_path);
    if (downloadError || !blob) throw badRequest("添付ファイルを確認できません。再アップロードしてください。");
    if (blob.size > Number(session.byte_limit)) throw payloadTooLarge("添付ファイルが申告サイズを超えています。");
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (bytes.length > pdfLimits.maxBytes) throw payloadTooLarge("添付ファイルは25MiB以下にしてください。");
    if (session.media_type === "application/pdf") {
      try {
        await assertSafePdf(bytes);
      } catch (error) {
        if (error instanceof PdfInputError && error.code === "pdf_too_large") throw payloadTooLarge("添付ファイルは25MiB以下にしてください。");
        throw badRequest("PDFファイルを確認できません。");
      }
    }
    if (session.media_type !== "application/pdf" && bytes.includes(0)) throw badRequest("テキストファイルを確認できません。");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { error: updateError } = await supabase.from("upload_sessions").update({ byte_size: bytes.length, sha256 }).eq("id", session.id).eq("owner_id", user.id);
    if (updateError) throw new Error("upload_session_finalize_failed");
  }
}

export async function createJob(user: AuthenticatedJobUser, raw: CreateJobRequest, idempotencyKey: string) {
  if (!idempotencyKey || idempotencyKey.length > 200) throw badRequest("Idempotency-Keyを指定してください。");
  const request = validateCreateRequest(raw);
  const inputKind = classifyInput(request);
  if (cloudflareStateEnabled()) {
    // G1 proves direct text first. Upload, URL and mixed input remain closed
    // until their D1/R2 provenance implementation is verified in later Gates.
    if (inputKind !== "text" || (request.attachmentIds?.length ?? 0) !== 0 || request.sourceUrl) {
      throw new PublicHttpError(503, "SERVICE_UNAVAILABLE", "この入力形式は現在準備中です。", 60);
    }
    const now = new Date();
    const created = await sendControlPlaneJobCommand<{ jobId: string }>({
      command: "create", ownerId: user.id, jobId: randomUUID(), revisionId: randomUUID(), dispatchId: randomUUID(), reservationId: randomUUID(),
      idempotencyKey, inputKind, requestJson: JSON.stringify({ request: request.request, sourceText: request.sourceText, sourceUrl: null, attachmentIds: [] }),
      imageModel: request.imageModel, workflowVersion: "kyozai-workflow@1", now: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString(), reservationExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
      reservedImageCalls: 24, reservedCostUnits: 57,
    });
    return created.jobId;
  }
  await finalizeUploads(user, request.attachmentIds ?? []);
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_kyozai_job", {
    p_owner_id: user.id,
    p_idempotency_key: idempotencyKey,
    p_input_kind: inputKind,
    p_request_json: { request: request.request, sourceText: request.sourceText ?? null, sourceUrl: request.sourceUrl ?? null, attachmentIds: request.attachmentIds },
    p_image_model: request.imageModel,
    p_attachment_ids: request.attachmentIds ?? [],
    p_workflow_version: "kyozai-workflow@1",
    p_reserved_image_calls: 24,
    // 24 image generations + 24 image QA calls + up to 9 structured-text calls.
    p_reserved_cost_units: 57,
  });
  if (error || !data) {
    if (error?.code === "23505") throw conflict("このIdempotency-Keyは別の入力に使用されています。");
    if (error?.code === "P0001") throw new PublicHttpError(503, "SERVICE_UNAVAILABLE", "現在は新しい教材生成を受け付けていません。", 60);
    throw new Error("job_create_failed");
  }
  return String(data);
}

function snapshotFromRows(job: Record<string, unknown>, revision: Record<string, unknown>, stages: Array<Record<string, unknown>>, artifacts: Array<Record<string, unknown>>): KyozaiJobSnapshot {
  const currentStage = typeof job.current_stage === "string" && isKyozaiJobStage(job.current_stage) ? job.current_stage : undefined;
  return {
    id: String(job.id), status: String(job.status) as KyozaiJobSnapshot["status"], currentStage,
    revision: Number(job.active_revision_number),
    stages: stages.map((stage): StageLedgerEntry => ({
      stage: String(stage.stage) as StageLedgerEntry["stage"],
      status: String(stage.status) as StageLedgerEntry["status"],
      attempt: Number(stage.attempt),
      ...(typeof stage.slide_number === "number" && stage.slide_number > 0 ? { slideNumber: stage.slide_number } : {}),
      ...(typeof stage.started_at === "string" ? { startedAt: stage.started_at } : {}),
      ...(typeof stage.completed_at === "string" ? { completedAt: stage.completed_at } : {}),
      inputArtifactIds: stringArray(stage.input_artifact_ids),
      outputArtifactIds: stringArray(stage.output_artifact_ids),
      validator: String(stage.validator),
      ...(typeof stage.model === "string" ? { model: stage.model } : {}),
      ...(parsedObject(stage.usage ?? stage.usage_json) ? { usage: parsedObject(stage.usage ?? stage.usage_json) as StageLedgerEntry["usage"] } : {}),
      ...(typeof stage.retry_reason === "string" ? { retryReason: stage.retry_reason } : {}),
      ...(typeof stage.error_code === "string" ? { errorCode: stage.error_code } : {}),
    })),
    artifacts: artifacts.map((artifact): ArtifactManifestEntry => ({
      artifactId: String(artifact.id),
      kind: String(artifact.kind) as ArtifactManifestEntry["kind"],
      revisionNumber: Number(revision.revision_number),
      storagePath: String(artifact.storage_path),
      sha256: String(artifact.sha256),
      mediaType: String(artifact.media_type),
      byteSize: Number(artifact.byte_size),
      status: String(artifact.lifecycle) as ArtifactManifestEntry["status"],
      ...(typeof artifact.slide_number === "number" ? { slideNumber: artifact.slide_number } : {}),
    })),
    ...(typeof job.error_code === "string" ? { errorCode: job.error_code } : {}),
    ...(revision.status === "failed" ? { warning: "この版は完成していません。" } : {}),
  };
}

export async function getJobSnapshot(user: AuthenticatedJobUser, jobId: string) {
  assertUuid(jobId, "jobを確認できません。");
  if (cloudflareStateEnabled()) {
    const result = await sendControlPlaneJobCommand<{ job: Record<string, unknown>; revision: Record<string, unknown>; stages: Array<Record<string, unknown>>; artifacts: Array<Record<string, unknown>> }>({ command: "read", ownerId: user.id, jobId });
    return snapshotFromRows(result.job, result.revision, result.stages, result.artifacts);
  }
  const supabase = createServerSupabaseClient();
  const { data: job, error } = await supabase.from("jobs").select("*").eq("id", jobId).eq("owner_id", user.id).maybeSingle();
  if (error) throw new Error("job_read_failed");
  if (!job) throw routeUnavailable();
  const { data: revision, error: revisionError } = await supabase.from("job_revisions")
    .select("id, revision_number, status")
    .eq("job_id", jobId)
    .eq("revision_number", job.active_revision_number)
    .maybeSingle();
  if (revisionError || !revision) throw new Error("job_revision_read_failed");
  const [{ data: stages }, { data: artifacts }] = await Promise.all([
    supabase.from("stage_runs").select("stage, status, attempt, slide_number, started_at, completed_at, input_artifact_ids, output_artifact_ids, validator, model, usage, retry_reason, error_code").eq("job_id", jobId).eq("revision_id", revision.id).order("created_at"),
    supabase.from("artifacts").select("id, kind, lifecycle, storage_path, media_type, byte_size, sha256, slide_number").eq("job_id", jobId).eq("revision_id", revision.id).eq("lifecycle", "final").order("created_at"),
  ]);
  return snapshotFromRows(job, revision, stages ?? [], artifacts ?? []);
}

export async function listJobs(user: AuthenticatedJobUser) {
  if (cloudflareStateEnabled()) {
    const result = await sendControlPlaneJobCommand<{ jobs: Array<Record<string, unknown>> }>({ command: "list", ownerId: user.id });
    return result.jobs.map((job) => ({ id: String(job.id), status: String(job.status) as KyozaiJobSnapshot["status"], currentStage: isKyozaiJobStage(String(job.current_stage)) ? String(job.current_stage) : undefined, revision: Number(job.active_revision_number), ...(typeof job.error_code === "string" ? { errorCode: job.error_code } : {}) }));
  }
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("jobs").select("id, status, current_stage, active_revision_number, error_code").eq("owner_id", user.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error("job_list_failed");
  return (data ?? []).map((job) => ({ id: job.id, status: job.status, currentStage: job.current_stage ?? undefined, revision: job.active_revision_number, ...(job.error_code ? { errorCode: job.error_code } : {}) }));
}

export async function cancelJob(user: AuthenticatedJobUser, jobId: string) {
  assertUuid(jobId, "jobを確認できません。");
  if (cloudflareStateEnabled()) {
    await sendControlPlaneJobCommand({ command: "cancel", ownerId: user.id, jobId, now: new Date().toISOString() });
    return;
  }
  const supabase = createServerSupabaseClient();
  const { data: owned, error: ownershipError } = await supabase.from("jobs").select("id").eq("id", jobId).eq("owner_id", user.id).maybeSingle();
  if (ownershipError) throw new Error("job_cancel_owner_check_failed");
  if (!owned) throw routeUnavailable();
  const { data: status, error } = await supabase.rpc("request_kyozai_job_cancellation", { p_job_id: jobId });
  if (error) throw new Error("job_cancel_failed");
  if (status !== "cancelling" && status !== "cancelled") throw conflict("このjobはキャンセルできません。");
}

export async function deleteJob(user: AuthenticatedJobUser, jobId: string) {
  assertUuid(jobId, "jobを確認できません。");
  if (cloudflareStateEnabled()) {
    await sendControlPlaneJobCommand({ command: "delete", ownerId: user.id, jobId, now: new Date().toISOString() });
    return;
  }
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("jobs").update({ status: "deleting", deleted_at: new Date().toISOString() }).eq("id", jobId).eq("owner_id", user.id).not("status", "in", "(running,cancelling)").select("id").maybeSingle();
  if (error) throw new Error("job_delete_failed");
  if (!data) throw conflict("実行中のjobは削除できません。");
}

export async function createRevisionCandidate(user: AuthenticatedJobUser, jobId: string, baseRevision: number, instruction: string): Promise<{ revisionId: string; plan: RevisionPlan }> {
  assertUuid(jobId, "jobを確認できません。");
  if (!Number.isInteger(baseRevision) || baseRevision < 1) throw badRequest("baseRevisionを確認してください。");
  const text = instruction.trim();
  if (text.length < 3 || text.length > 600) throw badRequest("修正指示を3〜600文字で入力してください。");
  const supabase = createServerSupabaseClient();
  // The service-role client must establish ownership before reading any
  // revision or artifact. This gives unowned and nonexistent jobs one path.
  const { data: owned, error: ownershipError } = await supabase.from("jobs").select("id").eq("id", jobId).eq("owner_id", user.id).is("deleted_at", null).maybeSingle();
  if (ownershipError) throw new Error("revision_owner_check_failed");
  if (!owned) throw routeUnavailable();
  const { data: base, error: baseError } = await supabase.from("job_revisions").select("id").eq("job_id", jobId).eq("revision_number", baseRevision).maybeSingle();
  if (baseError || !base) throw routeUnavailable();
  const { data: artifact, error: artifactError } = await supabase.from("artifacts").select("storage_bucket, storage_path").eq("revision_id", base.id).eq("kind", "deck_spec").eq("lifecycle", "final").maybeSingle();
  if (artifactError || !artifact) throw conflict("修正元の完成版を確認できません。");
  const { data: blob, error: downloadError } = await supabase.storage.from(artifact.storage_bucket).download(artifact.storage_path);
  if (downloadError || !blob) throw new Error("revision_base_download_failed");
  const deck = JSON.parse(Buffer.from(await blob.arrayBuffer()).toString("utf8")) as { slides?: Array<{ number?: unknown }> };
  const slideNumbers = (deck.slides ?? []).map((slide) => slide.number).filter((number): number is number => Number.isInteger(number));
  if (slideNumbers.length === 0) throw conflict("修正元のスライドを確認できません。");
  const plan = planRevision(text, slideNumbers);
  const { data, error } = await supabase.rpc("create_kyozai_revision_plan", { p_owner_id: user.id, p_job_id: jobId, p_base_revision_number: baseRevision, p_instruction: text, p_impact_scope: plan.impactScope });
  if (error?.code === "40001") throw conflict("この版は更新されています。最新の版を確認してやり直してください。");
  if (error || !data) throw new Error("revision_candidate_create_failed");
  return { revisionId: String(data), plan };
}

export async function createArtifactRedirect(user: AuthenticatedJobUser, jobId: string, artifactId: string) {
  assertUuid(jobId, "jobを確認できません。");
  assertUuid(artifactId, "成果物を確認できません。");
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("artifacts").select("storage_bucket, storage_path").eq("id", artifactId).eq("job_id", jobId).eq("lifecycle", "final").maybeSingle();
  if (error) throw new Error("artifact_read_failed");
  if (!data) throw routeUnavailable();
  const { data: owned } = await supabase.from("jobs").select("id").eq("id", jobId).eq("owner_id", user.id).maybeSingle();
  if (!owned) throw routeUnavailable();
  if (data.storage_bucket !== ARTIFACT_BUCKET && data.storage_bucket !== SOURCE_BUCKET) throw routeUnavailable();
  const signed = await supabase.storage.from(data.storage_bucket).createSignedUrl(data.storage_path, 60);
  if (signed.error || !signed.data?.signedUrl) throw new Error("artifact_url_create_failed");
  return signed.data.signedUrl;
}
