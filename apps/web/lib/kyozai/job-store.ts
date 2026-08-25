import { createHash, randomUUID } from "node:crypto";

import { createServerSupabaseClient } from "../supabase/server";
import { badRequest, conflict, payloadTooLarge, PublicHttpError, routeUnavailable } from "./http-errors";
import type { AuthenticatedJobUser } from "./job-auth";
import type { KyozaiJobSnapshot } from "./job-client";

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
    if (session.media_type === "application/pdf" && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw badRequest("PDFファイルを確認できません。");
    if (session.media_type !== "application/pdf" && bytes.includes(0)) throw badRequest("テキストファイルを確認できません。");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { error: updateError } = await supabase.from("upload_sessions").update({ byte_size: bytes.length, sha256 }).eq("id", session.id).eq("owner_id", user.id);
    if (updateError) throw new Error("upload_session_finalize_failed");
  }
}

export async function createJob(user: AuthenticatedJobUser, raw: CreateJobRequest, idempotencyKey: string) {
  if (!idempotencyKey || idempotencyKey.length > 200) throw badRequest("Idempotency-Keyを指定してください。");
  const request = validateCreateRequest(raw);
  await finalizeUploads(user, request.attachmentIds ?? []);
  const supabase = createServerSupabaseClient();
  const inputKind = classifyInput(request);
  const { data, error } = await supabase.rpc("create_kyozai_job", {
    p_owner_id: user.id,
    p_idempotency_key: idempotencyKey,
    p_input_kind: inputKind,
    p_request_json: { request: request.request, sourceText: request.sourceText ?? null, sourceUrl: request.sourceUrl ?? null, attachmentIds: request.attachmentIds },
    p_image_model: request.imageModel,
    p_attachment_ids: request.attachmentIds ?? [],
    p_workflow_version: "kyozai-workflow@1",
    p_reserved_image_calls: 24,
    p_reserved_cost_units: 24,
  });
  if (error || !data) {
    if (error?.code === "23505") throw conflict("このIdempotency-Keyは別の入力に使用されています。");
    if (error?.code === "P0001") throw new PublicHttpError(503, "SERVICE_UNAVAILABLE", "現在は新しい教材生成を受け付けていません。", 60);
    throw new Error("job_create_failed");
  }
  return String(data);
}

function snapshotFromRows(job: Record<string, unknown>, revisions: Array<Record<string, unknown>>, stages: Array<Record<string, unknown>>, artifacts: Array<Record<string, unknown>>): KyozaiJobSnapshot {
  const revision = revisions.find((item) => Number(item.revision_number) === Number(job.active_revision_number));
  return {
    id: String(job.id), status: String(job.status) as KyozaiJobSnapshot["status"], currentStage: typeof job.current_stage === "string" ? job.current_stage : undefined,
    revision: Number(job.active_revision_number),
    stages: stages.map((stage) => ({ name: String(stage.stage), status: String(stage.status) as KyozaiJobSnapshot["stages"][number]["status"], attempt: Number(stage.attempt), updatedAt: typeof stage.completed_at === "string" ? stage.completed_at : typeof stage.started_at === "string" ? stage.started_at : undefined, errorCode: typeof stage.error_code === "string" ? stage.error_code : undefined })),
    artifacts: artifacts.map((artifact) => ({ id: String(artifact.id), kind: String(artifact.kind), lifecycle: String(artifact.lifecycle) as KyozaiJobSnapshot["artifacts"][number]["lifecycle"], mediaType: String(artifact.media_type), byteSize: Number(artifact.byte_size), sha256: String(artifact.sha256), slideNumber: typeof artifact.slide_number === "number" ? artifact.slide_number : undefined })),
    ...(typeof job.error_code === "string" ? { errorCode: job.error_code } : {}),
    ...(revision?.status === "failed" ? { warning: "この版は完成していません。" } : {}),
  };
}

export async function getJobSnapshot(user: AuthenticatedJobUser, jobId: string) {
  assertUuid(jobId, "jobを確認できません。");
  const supabase = createServerSupabaseClient();
  const { data: job, error } = await supabase.from("jobs").select("*").eq("id", jobId).eq("owner_id", user.id).maybeSingle();
  if (error) throw new Error("job_read_failed");
  if (!job) throw routeUnavailable();
  const [{ data: revisions }, { data: stages }, { data: artifacts }] = await Promise.all([
    supabase.from("job_revisions").select("revision_number, status").eq("job_id", jobId),
    supabase.from("stage_runs").select("stage, status, attempt, started_at, completed_at, error_code").eq("job_id", jobId).order("created_at"),
    supabase.from("artifacts").select("id, kind, lifecycle, media_type, byte_size, sha256, slide_number").eq("job_id", jobId).eq("lifecycle", "final").order("created_at"),
  ]);
  return snapshotFromRows(job, revisions ?? [], stages ?? [], artifacts ?? []);
}

export async function listJobs(user: AuthenticatedJobUser) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("jobs").select("id, status, current_stage, active_revision_number, error_code").eq("owner_id", user.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error("job_list_failed");
  return (data ?? []).map((job) => ({ id: job.id, status: job.status, currentStage: job.current_stage ?? undefined, revision: job.active_revision_number, ...(job.error_code ? { errorCode: job.error_code } : {}) }));
}

export async function cancelJob(user: AuthenticatedJobUser, jobId: string) {
  assertUuid(jobId, "jobを確認できません。");
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("jobs").update({ status: "cancelling" }).eq("id", jobId).eq("owner_id", user.id).in("status", ["queued", "running"]).select("id").maybeSingle();
  if (error) throw new Error("job_cancel_failed");
  if (!data) throw conflict("このjobはキャンセルできません。");
}

export async function deleteJob(user: AuthenticatedJobUser, jobId: string) {
  assertUuid(jobId, "jobを確認できません。");
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("jobs").update({ status: "deleting", deleted_at: new Date().toISOString() }).eq("id", jobId).eq("owner_id", user.id).not("status", "in", "(running,cancelling)").select("id").maybeSingle();
  if (error) throw new Error("job_delete_failed");
  if (!data) throw conflict("実行中のjobは削除できません。");
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
