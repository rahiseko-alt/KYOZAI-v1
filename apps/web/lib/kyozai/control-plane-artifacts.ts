import { createHash, randomUUID } from "node:crypto";

import { getControlPlaneArtifactBytes, putControlPlaneArtifactBytes, sendControlPlaneCommand } from "./control-plane-client";

type Env = Record<string, string | undefined>;
type Fetcher = typeof fetch;

export type PrivateArtifactInput = {
  jobId: string;
  revisionId: string;
  kind: string;
  storageBucket: "kyozai-sources" | "kyozai-artifacts";
  storagePath: string;
  mediaType: string;
  bytes: Buffer;
  metadata: Record<string, unknown>;
  now: string;
  artifactId?: string;
};

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Registers only metadata first, then proves private R2 readback before validation. */
export async function writePrivateControlPlaneArtifact(input: PrivateArtifactInput, env: Env = process.env, fetcher: Fetcher = fetch) {
  const artifactId = input.artifactId ?? randomUUID();
  await sendControlPlaneCommand("artifacts", {
    command: "register", artifactId, jobId: input.jobId, revisionId: input.revisionId, kind: input.kind,
    storageBucket: input.storageBucket, storagePath: input.storagePath, mediaType: input.mediaType,
    byteSize: input.bytes.length, metadataJson: JSON.stringify(input.metadata), now: input.now,
  }, env, fetcher);
  const written = await putControlPlaneArtifactBytes(artifactId, input.bytes, input.mediaType, env, fetcher);
  if (written.artifactId !== artifactId || written.byteSize !== input.bytes.length) throw new Error("artifact_write_size_mismatch");
  const persisted = await getControlPlaneArtifactBytes(artifactId, env, fetcher);
  const checksum = sha256(input.bytes);
  if (persisted.length !== input.bytes.length || sha256(persisted) !== checksum) throw new Error("artifact_readback_hash_mismatch");
  await sendControlPlaneCommand("artifacts", { command: "validate", artifactId, sha256: checksum }, env, fetcher);
  return { artifactId, sha256: checksum, bytes: persisted };
}

export async function finalizePrivateControlPlaneArtifacts(jobId: string, revisionId: string, artifactIds: string[], now: string, env: Env = process.env, fetcher: Fetcher = fetch) {
  return sendControlPlaneCommand<{ finalized: number }>("artifacts", { command: "finalize", jobId, revisionId, artifactIds, now }, env, fetcher);
}

export async function readPrivateControlPlaneArtifact(artifactId: string, env: Env = process.env, fetcher: Fetcher = fetch) {
  const result = await sendControlPlaneCommand<{ artifact: { metadata: Record<string, unknown>; storage_path: string; sha256?: string | null } }>("artifacts", { command: "read", artifactId }, env, fetcher);
  return { ...result.artifact, bytes: await getControlPlaneArtifactBytes(artifactId, env, fetcher) };
}

export async function updatePrivateControlPlaneArtifactMetadata(artifactId: string, metadata: Record<string, unknown>, env: Env = process.env, fetcher: Fetcher = fetch) {
  return sendControlPlaneCommand<{ artifactId: string }>("artifacts", { command: "updateMetadata", artifactId, metadataJson: JSON.stringify(metadata) }, env, fetcher);
}
