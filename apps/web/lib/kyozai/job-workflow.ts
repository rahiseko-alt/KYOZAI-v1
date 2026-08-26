import { createHash, randomUUID } from "node:crypto";

import type { KyozaiArtifactKind, KyozaiJobStage } from "../../../../shared/kyozai-job-contract";

import { createServerSupabaseClient } from "../supabase/server";
import {
  buildDesignedPackage,
  generateScriptTiming,
  generateSlideMap,
  generateTeachingAnalysis,
  runContentFreezeGate,
  type ContentFreezeGate,
} from "./content-generation";
import { loadDurableSources } from "./durable-source";
import { createDurableMontage, createDurablePackage } from "./durable-package";
import { isImageModelId, type ImageModelId } from "./image-models";
import { mockRenderedSlide, renderValidatedSlide } from "./image-renderer";
import type { RenderedSlideImage } from "./image-types";
import { mockPackage } from "./mock";
import type { SourceInput, TeachingAnalysis, TeachingPackage } from "./types";
import type { ScriptStage, SlideMap } from "./content-pipeline";
import type { DurableContentStage } from "./durable-stages";
import { isE2eRuntimeAllowed } from "./e2e-runtime";
import { injectG1Fault } from "./g1-fault-injection";
import { withProviderAttemptContext } from "./provider-attempt";

const ARTIFACT_BUCKET = "kyozai-artifacts";
type StoredArtifact = { id: string; storagePath: string; sha256: string; bytes: Buffer };
type StageRun = { id: string; attempt: number; leaseOwner: string };
export type { DurableContentStage } from "./durable-stages";
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
async function withStage(jobId: string, revisionId: string, stage: KyozaiJobStage, slideNumber: number, work: (run: StageRun) => Promise<{ artifactIds: string[] }>): Promise<string[] | undefined> {
  const existing = await existingPassedArtifact(jobId, revisionId, stage, slideNumber);
  if (existing) return [existing];
  const run = await beginStage(jobId, revisionId, stage, slideNumber);
  if (!run) return undefined;
  const supabase = createServerSupabaseClient();
  try {
    const value = await withProviderAttemptContext({ jobId, revisionId, stageRunId: run.id, stage, slideNumber }, () => work(run));
    injectG1Fault("before_stage_pass", { stageAttempt: run.attempt });
    const { data: passed, error } = await supabase.rpc("pass_kyozai_stage_run", {
      p_stage_run_id: run.id, p_lease_owner: run.leaseOwner, p_output_artifact_ids: value.artifactIds,
      p_validator: `durable-${stage}`, p_usage: {},
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
  // Storage is the delivery source of truth. Validate the object read back from
  // private storage before a database row can become validated/final.
  const { data: persisted, error: persistedError } = await supabase.storage.from(ARTIFACT_BUCKET).download(storagePath);
  if (persistedError || !persisted) throw new Error("artifact_readback_failed"); const persistedBytes = Buffer.from(await persisted.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex"); if (persistedBytes.length !== bytes.length || createHash("sha256").update(persistedBytes).digest("hex") !== checksum) {
    throw new Error("artifact_readback_hash_mismatch");
  }
  const { error: insertError } = await supabase.from("artifacts").insert({ id, job_id: jobId, revision_id: revisionId, kind, lifecycle: "draft", storage_bucket: ARTIFACT_BUCKET, storage_path: storagePath, media_type: mediaType, byte_size: bytes.length, ...(slideNumber ? { slide_number: slideNumber } : {}) });
  if (insertError) throw new Error("artifact_insert_failed");
  const { error: validateError } = await supabase.from("artifacts").update({ lifecycle: "validated", sha256: checksum }).eq("id", id).eq("lifecycle", "draft");
  if (validateError) throw new Error("artifact_validation_failed");
  return { id, storagePath, sha256: checksum, bytes };
}

async function storeJson(jobId: string, revisionId: string, kind: KyozaiArtifactKind, name: string, value: unknown) {
  return storeArtifact(jobId, revisionId, kind, name, Buffer.from(JSON.stringify(value, null, 2)), "application/json");
}

export async function loadOrCreatePackage(jobId: string, revisionId: string, request: Record<string, unknown>, stopAfter?: DurableContentStage): Promise<TeachingPackage | undefined> {
  const existingDesign = await existingPassedArtifact(jobId, revisionId, "design"); if (existingDesign) return readJsonArtifact<TeachingPackage>(existingDesign);
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
  if (!sources) throw new Error("durable_source_stage_unavailable"); if (stopAfter === "source_ingest") return undefined;
  const requestText = String(request.request ?? "");

  async function stageValue<T>(stage: Extract<KyozaiJobStage, "analysis" | "slide_map" | "script_timing">, kind: KyozaiArtifactKind, create: () => Promise<T>): Promise<T> {
    const existing = await existingPassedArtifact(jobId, revisionId, stage);
    if (existing) return readJsonArtifact<T>(existing);
    let value: T | undefined;
    const outputIds = await withStage(jobId, revisionId, stage, 0, async () => {
      value = await create();
      const artifact = await storeJson(jobId, revisionId, kind, `${stage}.json`, value);
      return { artifactIds: [artifact.id] };
    });
    if (value !== undefined) return value;
    if (outputIds?.[0]) return readJsonArtifact<T>(outputIds[0]);
    throw new Error(`${stage}_stage_busy`);
  }

  const fixture = isE2eRuntimeAllowed() ? structuredClone(mockPackage) : undefined;
  const analysis = await stageValue<TeachingAnalysis>("analysis", "source_info", async () => fixture?.process!.analysis ?? generateTeachingAnalysis(sources!, requestText)); if (stopAfter === "analysis") return undefined;
  const map = await stageValue<SlideMap>("slide_map", "deck_content_and_script", async () => fixture
    ? { title: fixture.title, sourceSummary: fixture.sourceSummary, learningObjectives: fixture.learningObjectives, slides: fixture.slides.map((slide) => ({ number: slide.number, layoutFamily: slide.layoutFamily, labels: slide.labels, theme: slide.theme, role: slide.role, title: slide.title, keyMessage: slide.keyMessage, bullets: slide.bullets, composition: slide.composition ?? `slide ${slide.number}の表示要素を内容に沿って配置する` })) }
    : generateSlideMap(sources!, requestText, analysis)); if (stopAfter === "slide_map") return undefined;
  const scripts = await stageValue<ScriptStage>("script_timing", "deck_content_and_script", async () => fixture
    ? { slides: fixture.slides.map(({ number, speakerNotes }) => ({ number, speakerNotes })), scenario: fixture.scenario, faq: fixture.faq, quiz: fixture.quiz }
    : generateScriptTiming(sources!, requestText, analysis, map)); if (stopAfter === "script_timing") return undefined;

  const existingFreeze = await existingPassedArtifact(jobId, revisionId, "content_freeze");
  let gate: ContentFreezeGate;
  if (existingFreeze) {
    gate = await readJsonArtifact<ContentFreezeGate>(existingFreeze);
  } else {
    let created: ContentFreezeGate | undefined;
    const outputIds = await withStage(jobId, revisionId, "content_freeze", 0, async () => {
      created = fixture
        ? { review: fixture.process!.contentFreeze, map, scripts, repaired: false }
        : await runContentFreezeGate(sources!, requestText, analysis, map, scripts);
      // Keep the review itself, including a rejected review.  A failed gate is a
      // completed decision, never an image-generation retry signal.
      const artifact = await storeJson(jobId, revisionId, "deck_content_and_script", "content-freeze.json", created);
      return { artifactIds: [artifact.id] };
    });
    if (created) gate = created;
    else if (outputIds?.[0]) gate = await readJsonArtifact<ContentFreezeGate>(outputIds[0]);
    else throw new Error("content_freeze_stage_busy");
  }
  if (!gate.review.passed || gate.review.issues.length) throw new Error("content_freeze_rejected"); if (stopAfter === "content_freeze") return undefined;

  const existingPackage = await existingPassedArtifact(jobId, revisionId, "design");
  if (existingPackage) return readJsonArtifact<TeachingPackage>(existingPackage);
  let teachingPackage: TeachingPackage | undefined;
  const designOutput = await withStage(jobId, revisionId, "design", 0, async () => {
    teachingPackage = buildDesignedPackage(sources!, analysis, gate.map, gate.scripts, gate.review);
    const artifact = await storeJson(jobId, revisionId, "deck_spec", "deck-spec.json", teachingPackage);
    return { artifactIds: [artifact.id] };
  });
  if (teachingPackage) return teachingPackage;
  if (designOutput?.[0]) return readJsonArtifact<TeachingPackage>(designOutput[0]);
  throw new Error("design_stage_busy");
}

export async function renderSlides(jobId: string, revisionId: string, teachingPackage: TeachingPackage, modelId: ImageModelId, slides = teachingPackage.slides) {
  const images: Array<RenderedSlideImage & { bytes: Buffer; artifactId: string }> = [];
  for (const slide of slides) {
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
        const rendered = isE2eRuntimeAllowed() ? await mockRenderedSlide(teachingPackage, slide, modelId) : await renderValidatedSlide(teachingPackage, slide, modelId, Date.now() + 14 * 60_000);
        const bytes = Buffer.from(rendered.data, "base64");
        const artifact = await storeArtifact(jobId, revisionId, "slide_image", `slide-${String(slide.number).padStart(2, "0")}.png`, bytes, "image/png", slide.number);
        created = { ...rendered, bytes, artifactId: artifact.id };
        const supabase = createServerSupabaseClient();
        await supabase.from("artifacts").update({ metadata: { ...rendered, data: undefined } }).eq("id", artifact.id);
        return { artifactIds: [artifact.id] };
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
    const validation = await withStage(jobId, revisionId, "image_validate", slide.number, async () => ({ artifactIds: [image.artifactId] }));
    if (!validation) throw new Error("image_validation_stage_busy");
    images.push(image);
  }
  return images;
}

export async function finalizePackage(jobId: string, revisionId: string, teachingPackage: TeachingPackage, images: Array<RenderedSlideImage & { bytes: Buffer; artifactId: string }>) {
  const packageArtifact = await existingPassedArtifact(jobId, revisionId, "package");
  if (packageArtifact) {
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
    return { artifactIds: [zip.id] };
  });
  if (!completedArtifactId) throw new Error("package_stage_busy");
  return completedArtifactId;
}

export async function markJobCompleted(jobId: string, revisionId: string) {
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
  return error instanceof Error && (
    error.message.endsWith("_stage_busy")
    || error.message.startsWith("provider_checkpoint_")
    || error.message === "provider_attempt_settlement_failed"
  );
}

export async function markWorkflowFailed(jobId: string) {
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
  await supabase.rpc("release_kyozai_unused_quota", { p_job_id: jobId });
}

export async function loadExecutableJob(jobId: string) {
  const supabase = createServerSupabaseClient();
  const { data: job, error } = await supabase.from("jobs").select("request_json, image_model, status").eq("id", jobId).maybeSingle();
  if (error || !job) throw new Error("job_not_found");
  if (isWorkflowTerminalStatus(job.status) || job.status === "cancelling") return;
  if (!isImageModelId(job.image_model)) throw new Error("job_image_model_invalid");
  return job;
}

export { CONTENT_STAGES, runKyozaiContentStage, runKyozaiContentStages, runKyozaiJobWorkflow, runKyozaiPackagingStage, runKyozaiSlideStage } from "./job-workflow-execution";
