import { createHash, randomUUID } from "node:crypto";

import type { KyozaiArtifactKind } from "../../../../shared/kyozai-job-contract";

import { createServerSupabaseClient } from "../supabase/server";
import { cloudflareStateEnabled } from "./control-plane-client";
import { readPrivateControlPlaneArtifact, writePrivateControlPlaneArtifact } from "./control-plane-artifacts";
import type { RenderedSlideImage } from "./image-types";

const ARTIFACT_BUCKET = "kyozai-artifacts";

export type StoredArtifact = { id: string; storagePath: string; sha256: string; bytes: Buffer };

function artifactPath(jobId: string, revisionId: string, lifecycle: "draft" | "validated", id: string, name: string) {
  return `${jobId}/${revisionId}/${lifecycle}/${id}-${name}`;
}

export async function storeArtifact(jobId: string, revisionId: string, kind: KyozaiArtifactKind, name: string, bytes: Buffer, mediaType: string, slideNumber?: number): Promise<StoredArtifact> {
  const id = randomUUID();
  const storagePath = artifactPath(jobId, revisionId, "draft", id, name);
  if (cloudflareStateEnabled()) {
    const stored = await writePrivateControlPlaneArtifact({ artifactId: id, jobId, revisionId, kind, storageBucket: ARTIFACT_BUCKET, storagePath, mediaType, bytes, metadata: slideNumber ? { slideNumber } : {}, now: new Date().toISOString() });
    return { id: stored.artifactId, storagePath, sha256: stored.sha256, bytes: stored.bytes };
  }
  const supabase = createServerSupabaseClient();
  const { error: uploadError } = await supabase.storage.from(ARTIFACT_BUCKET).upload(storagePath, bytes, { contentType: mediaType, upsert: false });
  if (uploadError) throw new Error("artifact_upload_failed");
  const { data: persisted, error: persistedError } = await supabase.storage.from(ARTIFACT_BUCKET).download(storagePath);
  if (persistedError || !persisted) throw new Error("artifact_readback_failed");
  const persistedBytes = Buffer.from(await persisted.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (persistedBytes.length !== bytes.length || createHash("sha256").update(persistedBytes).digest("hex") !== checksum) throw new Error("artifact_readback_hash_mismatch");
  const { error: insertError } = await supabase.from("artifacts").insert({ id, job_id: jobId, revision_id: revisionId, kind, lifecycle: "draft", storage_bucket: ARTIFACT_BUCKET, storage_path: storagePath, media_type: mediaType, byte_size: bytes.length, ...(slideNumber ? { slide_number: slideNumber } : {}) });
  if (insertError) throw new Error("artifact_insert_failed");
  const { error: validateError } = await supabase.from("artifacts").update({ lifecycle: "validated", sha256: checksum }).eq("id", id).eq("lifecycle", "draft");
  if (validateError) throw new Error("artifact_validation_failed");
  return { id, storagePath, sha256: checksum, bytes };
}

export async function storeJson(jobId: string, revisionId: string, kind: KyozaiArtifactKind, name: string, value: unknown) {
  return storeArtifact(jobId, revisionId, kind, name, Buffer.from(JSON.stringify(value, null, 2)), "application/json");
}

export async function readExistingImageArtifact(artifactId: string) {
  if (cloudflareStateEnabled()) {
    const artifact = await readPrivateControlPlaneArtifact(artifactId);
    return { ...(artifact.metadata as Omit<RenderedSlideImage, "data">), data: "", bytes: artifact.bytes, artifactId } as RenderedSlideImage & { bytes: Buffer; artifactId: string };
  }
  const supabase = createServerSupabaseClient();
  const { data: artifact } = await supabase.from("artifacts").select("id, storage_bucket, storage_path, metadata").eq("id", artifactId).maybeSingle();
  if (!artifact) throw new Error("existing_image_missing");
  const { data: blob, error } = await supabase.storage.from(artifact.storage_bucket).download(artifact.storage_path);
  if (error || !blob) throw new Error("existing_image_download_failed");
  return { ...(artifact.metadata as Omit<RenderedSlideImage, "data">), data: "", bytes: Buffer.from(await blob.arrayBuffer()), artifactId: artifact.id } as RenderedSlideImage & { bytes: Buffer; artifactId: string };
}
