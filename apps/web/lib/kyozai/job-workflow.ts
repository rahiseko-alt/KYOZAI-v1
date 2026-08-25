import { createHash, randomUUID } from "node:crypto";

import type { KyozaiArtifactKind, KyozaiJobStage } from "../../../../shared/kyozai-job-contract";

import { createServerSupabaseClient } from "../supabase/server";
import { generatePackage } from "./content-generation";
import { loadDurableSources } from "./durable-source";
import { createDurableMontage, createDurablePackage } from "./durable-package";
import { isImageModelId, type ImageModelId } from "./image-models";
import { mockRenderedSlide, renderValidatedSlide } from "./image-renderer";
import type { RenderedSlideImage } from "./image-types";
import { mockPackage } from "./mock";
import type { SourceInput, TeachingPackage } from "./types";

const contentStages: KyozaiJobStage[] = ["source_ingest", "analysis", "slide_map", "script_timing", "content_freeze", "design"];
const ARTIFACT_BUCKET = "kyozai-artifacts";
type StoredArtifact = { id: string; storagePath: string; sha256: string; bytes: Buffer };
type StageRun = { id: string; attempt: number; leaseOwner: string };

function artifactPath(jobId: string, revisionId: string, lifecycle: "draft" | "validated", id: string, name: string) {
  return `${jobId}/${revisionId}/${lifecycle}/${id}-${name}`;
}

async function existingPassedArtifact(jobId: string, revisionId: string, stage: KyozaiJobStage, slideNumber = 0): Promise<string | undefined> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase.from("stage_runs").select("output_artifact_ids").eq("job_id", jobId).eq("revision_id", revisionId)
    .eq("stage", stage).eq("slide_number", slideNumber).eq("status", "passed").order("attempt", { ascending: false }).limit(1).maybeSingle();
  const ids = data?.output_artifact_ids;
  const artifactId = Array.isArray(ids) && typeof ids[0] === "string" ? ids[0] : undefined;
  if (!artifactId) return undefined;
  // A passed stage is reusable only while its output remains a validated or final
  // artifact. This prevents a resumed worker from treating a deleted draft as input.
  const { data: artifact } = await supabase.from("artifacts").select("id").eq("id", artifactId)
    .in("lifecycle", ["validated", "final"]).maybeSingle();
  return artifact ? artifactId : undefined;
}

async function readJsonArtifact<T>(artifactId: string): Promise<T> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("artifacts").select("storage_bucket, storage_path").eq("id", artifactId).maybeSingle();
  if (error || !data) throw new Error("workflow_artifact_not_found");
  const { data: blob, error: downloadError } = await supabase.storage.from(data.storage_bucket).download(data.storage_path);
  if (downloadError || !blob) throw new Error("workflow_artifact_download_failed");
  return JSON.parse(Buffer.from(await blob.arrayBuffer()).toString("utf8")) as T;
}

async function beginStage(jobId: string, revisionId: string, stage: KyozaiJobStage, slideNumber = 0): Promise<StageRun | undefined> {
  if (await existingPassedArtifact(jobId, revisionId, stage, slideNumber)) return undefined;
  const supabase = createServerSupabaseClient();
  const { data: latest } = await supabase.from("stage_runs").select("id, attempt, status").eq("job_id", jobId).eq("revision_id", revisionId)
    .eq("stage", stage).eq("slide_number", slideNumber).order("attempt", { ascending: false }).limit(1).maybeSingle();
  const inserted = latest?.status === "pending" || latest?.status === "running"
    ? latest
    : (await supabase.from("stage_runs").insert({ job_id: jobId, revision_id: revisionId, stage, slide_number: slideNumber, validator: `durable-${stage}` }).select("id, attempt, status").single()).data;
  if (!inserted) throw new Error("stage_create_failed");
  const leaseOwner = `workflow-${randomUUID()}`;
  const { data: claim, error } = await supabase.rpc("claim_kyozai_stage_run", { p_stage_run_id: inserted.id, p_lease_owner: leaseOwner, p_lease_seconds: 900 });
  if (error) throw new Error("stage_lease_failed");
  if (!claim?.[0]) return undefined;
  return { id: inserted.id, attempt: Number(inserted.attempt), leaseOwner };
}

async function withStage(jobId: string, revisionId: string, stage: KyozaiJobStage, slideNumber: number, work: (run: StageRun) => Promise<{ artifactIds: string[]; usage?: Record<string, unknown> }>): Promise<string[] | undefined> {
  const existing = await existingPassedArtifact(jobId, revisionId, stage, slideNumber);
  if (existing) return [existing];
  const run = await beginStage(jobId, revisionId, stage, slideNumber);
  if (!run) return undefined;
  const supabase = createServerSupabaseClient();
  try {
    const value = await work(run);
    const { data: passed, error } = await supabase.rpc("pass_kyozai_stage_run", {
      p_stage_run_id: run.id, p_lease_owner: run.leaseOwner, p_output_artifact_ids: value.artifactIds,
      p_validator: `durable-${stage}`, p_usage: value.usage ?? {},
    });
    if (error || !passed) throw new Error("stage_pass_failed");
    return value.artifactIds;
  } catch (error) {
    await supabase.rpc("fail_kyozai_stage_run", { p_stage_run_id: run.id, p_lease_owner: run.leaseOwner, p_error_code: "WORKER_STAGE_FAILED", p_retry_reason: error instanceof Error ? error.message : "unknown", p_retry: stage === "image_generate" && run.attempt < 1 });
    throw error;
  }
}

async function storeArtifact(jobId: string, revisionId: string, kind: KyozaiArtifactKind, name: string, bytes: Buffer, mediaType: string, slideNumber?: number): Promise<StoredArtifact> {
  const supabase = createServerSupabaseClient();
  const id = randomUUID();
  const storagePath = artifactPath(jobId, revisionId, "draft", id, name);
  const { error: uploadError } = await supabase.storage.from(ARTIFACT_BUCKET).upload(storagePath, bytes, { contentType: mediaType, upsert: false });
  if (uploadError) throw new Error("artifact_upload_failed");
  const { error: insertError } = await supabase.from("artifacts").insert({ id, job_id: jobId, revision_id: revisionId, kind, lifecycle: "draft", storage_bucket: ARTIFACT_BUCKET, storage_path: storagePath, media_type: mediaType, byte_size: bytes.length, ...(slideNumber ? { slide_number: slideNumber } : {}) });
  if (insertError) throw new Error("artifact_insert_failed");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const { error: validateError } = await supabase.from("artifacts").update({ lifecycle: "validated", sha256: checksum }).eq("id", id).eq("lifecycle", "draft");
  if (validateError) throw new Error("artifact_validation_failed");
  return { id, storagePath, sha256: checksum, bytes };
}

async function storeJson(jobId: string, revisionId: string, kind: KyozaiArtifactKind, name: string, value: unknown) {
  return storeArtifact(jobId, revisionId, kind, name, Buffer.from(JSON.stringify(value, null, 2)), "application/json");
}

async function loadOrCreatePackage(jobId: string, revisionId: string, request: Record<string, unknown>) {
  const existing = await existingPassedArtifact(jobId, revisionId, "content_freeze");
  if (existing) return readJsonArtifact<TeachingPackage>(existing);
  const existingSources = await existingPassedArtifact(jobId, revisionId, "source_ingest");
  let sources = existingSources ? await readJsonArtifact<SourceInput[]>(existingSources) : undefined;
  if (!sources) {
    const outputIds = await withStage(jobId, revisionId, "source_ingest", 0, async () => {
      const loaded = await loadDurableSources(jobId, request, createServerSupabaseClient());
      const artifact = await storeJson(jobId, revisionId, "source", "source-inputs.json", loaded);
      sources = loaded;
      return { artifactIds: [artifact.id] };
    });
    if (!outputIds) throw new Error("source_ingest_stage_busy");
    if (!sources && outputIds[0]) sources = await readJsonArtifact<SourceInput[]>(outputIds[0]);
  }
  if (!sources) throw new Error("durable_source_stage_unavailable");
  const outputs = new Map<KyozaiJobStage, unknown>();
  const generated = process.env.KYOZAI_E2E_MODE === "1" ? structuredClone(mockPackage) : await generatePackage(sources, String(request.request ?? ""), Number.POSITIVE_INFINITY, async (stage, output) => { outputs.set(stage, output); });
  for (const stage of contentStages.filter((stage) => stage !== "source_ingest")) {
    const outputIds = await withStage(jobId, revisionId, stage, 0, async () => {
      const kind: KyozaiArtifactKind = stage === "content_freeze" ? "deck_spec" : stage === "design" ? "design_profile" : "source_info";
      const artifact = await storeJson(jobId, revisionId, kind, `${stage}.json`, stage === "content_freeze" ? generated : (outputs.get(stage) ?? generated));
      return { artifactIds: [artifact.id] };
    });
    if (!outputIds) throw new Error("content_stage_busy");
  }
  return generated;
}

async function renderSlides(jobId: string, revisionId: string, teachingPackage: TeachingPackage, modelId: ImageModelId) {
  const images: Array<RenderedSlideImage & { bytes: Buffer; artifactId: string }> = [];
  for (const slide of teachingPackage.slides) {
    const existingImageId = await existingPassedArtifact(jobId, revisionId, "image_generate", slide.number);
    let image: RenderedSlideImage & { bytes: Buffer; artifactId: string };
    if (existingImageId) {
      const supabase = createServerSupabaseClient();
      const { data: artifact } = await supabase.from("artifacts").select("id, storage_bucket, storage_path, metadata").eq("id", existingImageId).maybeSingle();
      if (!artifact) throw new Error("existing_image_missing");
      const { data: blob, error } = await supabase.storage.from(artifact.storage_bucket).download(artifact.storage_path);
      if (error || !blob) throw new Error("existing_image_download_failed");
      image = { ...(artifact.metadata as Omit<RenderedSlideImage, "data">), data: "", bytes: Buffer.from(await blob.arrayBuffer()), artifactId: artifact.id } as RenderedSlideImage & { bytes: Buffer; artifactId: string };
    } else {
      let created: (RenderedSlideImage & { bytes: Buffer; artifactId: string }) | undefined;
      const outputIds = await withStage(jobId, revisionId, "image_generate", slide.number, async () => {
        const rendered = process.env.KYOZAI_E2E_MODE === "1" ? await mockRenderedSlide(teachingPackage, slide, modelId) : await renderValidatedSlide(teachingPackage, slide, modelId, Date.now() + 14 * 60_000);
        const bytes = Buffer.from(rendered.data, "base64");
        const artifact = await storeArtifact(jobId, revisionId, "slide_image", `slide-${String(slide.number).padStart(2, "0")}.png`, bytes, "image/png", slide.number);
        created = { ...rendered, bytes, artifactId: artifact.id };
        const supabase = createServerSupabaseClient();
        await supabase.from("artifacts").update({ metadata: { ...rendered, data: undefined } }).eq("id", artifact.id);
        return { artifactIds: [artifact.id], usage: { provider: modelId, model: rendered.providerModel, requestFingerprint: rendered.promptHash, imageCount: 1, chargeState: "confirmed" } };
      });
      if (created) {
        image = created;
      } else if (outputIds?.[0]) {
        // Another recovered worker may have completed the same stage between the
        // initial lookup and our lease claim. Reuse its validated result instead
        // of reporting a false generation failure.
        const artifactId = outputIds[0];
        const supabase = createServerSupabaseClient();
        const { data: artifact } = await supabase.from("artifacts").select("id, storage_bucket, storage_path, metadata").eq("id", artifactId).maybeSingle();
        if (!artifact) throw new Error("existing_image_missing");
        const { data: blob, error } = await supabase.storage.from(artifact.storage_bucket).download(artifact.storage_path);
        if (error || !blob) throw new Error("existing_image_download_failed");
        image = { ...(artifact.metadata as Omit<RenderedSlideImage, "data">), data: "", bytes: Buffer.from(await blob.arrayBuffer()), artifactId: artifact.id } as RenderedSlideImage & { bytes: Buffer; artifactId: string };
      } else {
        // The stage is owned by another live worker. Let the outbox retry instead
        // of continuing to package an incomplete deck.
        throw new Error("image_generation_stage_busy");
      }
    }
    await withStage(jobId, revisionId, "image_validate", slide.number, async () => ({ artifactIds: [image.artifactId], usage: { model: image.qaModel, requestFingerprint: image.imageHash } }));
    images.push(image);
  }
  return images;
}

async function finalizePackage(jobId: string, revisionId: string, teachingPackage: TeachingPackage, images: Array<RenderedSlideImage & { bytes: Buffer; artifactId: string }>) {
  const packageArtifact = await existingPassedArtifact(jobId, revisionId, "package");
  if (packageArtifact) {
    await markJobCompleted(jobId, revisionId);
    return packageArtifact;
  }
  let completedArtifactId: string | undefined;
  await withStage(jobId, revisionId, "package", 0, async () => {
    const montage = await createDurableMontage(images.map((image) => ({ slideNumber: image.slideNumber, bytes: image.bytes })));
    const built = await createDurablePackage(teachingPackage, images, montage);
    const artifacts = await Promise.all(built.artifacts.map((item) => storeArtifact(jobId, revisionId, item.kind, item.name, item.bytes, item.mediaType)));
    const zip = await storeArtifact(jobId, revisionId, "package_zip", "package.zip", built.packageZip, "application/zip");
    const ids = [...artifacts.map((artifact) => artifact.id), ...images.map((image) => image.artifactId), zip.id];
    const supabase = createServerSupabaseClient();
    const { error: promoteError } = await supabase.rpc("promote_kyozai_artifacts_to_final", { p_job_id: jobId, p_revision_id: revisionId, p_artifact_ids: ids });
    if (promoteError) throw new Error("artifact_promotion_failed");
    completedArtifactId = zip.id;
    return { artifactIds: [zip.id], usage: { requestFingerprint: createHash("sha256").update(built.packageZip).digest("hex") } };
  });
  if (!completedArtifactId) throw new Error("package_unavailable");
  await markJobCompleted(jobId, revisionId);
  return completedArtifactId;
}

async function markJobCompleted(jobId: string, revisionId: string) {
  const supabase = createServerSupabaseClient();
  const { data: job, error: jobReadError } = await supabase.from("jobs").select("status").eq("id", jobId).maybeSingle();
  if (jobReadError || !job) throw new Error("job_completion_failed");
  if (job.status === "cancelling" || job.status === "cancelled") return;
  if (job.status !== "completed") {
    const { error } = await supabase.from("jobs").update({ status: "completed", current_stage: null, error_code: null }).eq("id", jobId).in("status", ["queued", "running"]);
    if (error) throw new Error("job_completion_failed");
  }
  const { error: revisionError } = await supabase.from("job_revisions").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", revisionId).in("status", ["queued", "running"]);
  if (revisionError) throw new Error("revision_completion_failed");
}

export function isWorkflowTerminalStatus(status: unknown) {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "deleting" || status === "deleted";
}

export function isBusyStageError(error: unknown) {
  return error instanceof Error && error.message.endsWith("_stage_busy");
}

async function markWorkflowFailed(jobId: string) {
  const supabase = createServerSupabaseClient();
  const { data: job } = await supabase.from("jobs").select("status").eq("id", jobId).maybeSingle();
  if (!job || isWorkflowTerminalStatus(job.status)) return;
  const { data: retryingRun } = await supabase.from("stage_runs").select("id").eq("job_id", jobId).eq("status", "pending").gt("attempt", 0).limit(1).maybeSingle();
  if (retryingRun) return;
  if (job.status === "cancelling") {
    await supabase.rpc("settle_kyozai_job_cancellation", { p_job_id: jobId });
    return;
  }
  await supabase.from("jobs").update({ status: "failed", error_code: "workflow_failed", current_stage: null }).eq("id", jobId).in("status", ["queued", "running"]);
}

/** Durable worker entrypoint. It never falls back to public synchronous routes. */
export async function runKyozaiJobWorkflow(jobId: string, revisionId: string): Promise<void> {
  const supabase = createServerSupabaseClient();
  const { data: job, error } = await supabase.from("jobs").select("request_json, image_model, status").eq("id", jobId).maybeSingle();
  if (error || !job) throw new Error("job_not_found");
  if (isWorkflowTerminalStatus(job.status) || job.status === "cancelling") return;
  if (!isImageModelId(job.image_model)) throw new Error("job_image_model_invalid");
  try {
    const teachingPackage = await loadOrCreatePackage(jobId, revisionId, job.request_json as Record<string, unknown>);
    const images = await renderSlides(jobId, revisionId, teachingPackage, job.image_model);
    await finalizePackage(jobId, revisionId, teachingPackage, images);
  } catch (workflowError) {
    if (!isBusyStageError(workflowError)) await markWorkflowFailed(jobId);
    throw workflowError;
  }
}
