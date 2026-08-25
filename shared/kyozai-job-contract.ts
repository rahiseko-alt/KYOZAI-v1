/**
 * Persistent-job contract shared by the APP, workflow workers, and package validators.
 * This file intentionally contains no provider or database implementation details.
 */

export const KYOZAI_JOB_CONTRACT_ID = "kyozai-job@1.0.0";

export const KYOZAI_JOB_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
  "deleting",
  "deleted",
] as const;

export const KYOZAI_STAGE_STATUSES = ["pending", "running", "passed", "failed", "skipped"] as const;

export const KYOZAI_ARTIFACT_STATUSES = ["draft", "validated", "final", "deleted"] as const;

export const KYOZAI_JOB_STAGES = [
  "source_ingest",
  "analysis",
  "slide_map",
  "script_timing",
  "content_freeze",
  "design",
  "image_generate",
  "image_validate",
  "package",
  "revision",
] as const;

export const KYOZAI_ARTIFACT_KINDS = [
  "source",
  "attachment_original",
  "attachment_normalized",
  "deck_spec",
  "deck_content_and_script",
  "source_info",
  "design_profile",
  "image_prompt",
  "image_prompts",
  "slide_image",
  "image_validation",
  "montage",
  "manifest",
  "package_zip",
  "revision_request",
  "revision_plan",
  "revision_validation",
] as const;

export type KyozaiJobStatus = (typeof KYOZAI_JOB_STATUSES)[number];
export type KyozaiStageStatus = (typeof KYOZAI_STAGE_STATUSES)[number];
export type KyozaiArtifactStatus = (typeof KYOZAI_ARTIFACT_STATUSES)[number];
export type KyozaiJobStage = (typeof KYOZAI_JOB_STAGES)[number];
export type KyozaiArtifactKind = (typeof KYOZAI_ARTIFACT_KINDS)[number];
export type RevisionImpactScope = "visual_only" | "local_content" | "structural";

export type UsageRecord = {
  provider?: string;
  model?: string;
  requestFingerprint?: string;
  inputUnits?: number;
  outputUnits?: number;
  imageCount?: number;
  estimatedCostUnits?: number;
  actualCostUnits?: number;
  chargeState?: "reserved" | "confirmed" | "ambiguous" | "released";
};

export type StageLedgerEntry = {
  stage: KyozaiJobStage;
  status: KyozaiStageStatus;
  attempt: number;
  slideNumber?: number;
  startedAt?: string;
  completedAt?: string;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  validator: string;
  model?: string;
  usage?: UsageRecord;
  retryReason?: string;
  errorCode?: string;
};

export type ArtifactManifestEntry = {
  artifactId: string;
  kind: KyozaiArtifactKind;
  revisionNumber: number;
  storagePath: string;
  sha256: string;
  mediaType: string;
  byteSize: number;
  status: KyozaiArtifactStatus;
  slideNumber?: number;
};

export type KyozaiJob = {
  id: string;
  ownerId: string;
  status: KyozaiJobStatus;
  currentStage?: KyozaiJobStage;
  activeRevisionNumber: number;
  workflowVersion: string;
  inputKind: "text" | "url" | "attachments" | "mixed";
  expiresAt: string;
  errorCode?: string;
};

export const isKyozaiJobStage = (value: string): value is KyozaiJobStage =>
  (KYOZAI_JOB_STAGES as readonly string[]).includes(value);

export const isTerminalJobStatus = (status: KyozaiJobStatus) =>
  status === "completed" || status === "failed" || status === "cancelled" || status === "deleted";

export const canTransitionJobStatus = (from: KyozaiJobStatus, to: KyozaiJobStatus) => {
  if (from === to) return true;
  if (isTerminalJobStatus(from)) return false;
  if (from === "queued") return to === "running" || to === "cancelling" || to === "failed";
  if (from === "running") return to === "completed" || to === "failed" || to === "cancelling";
  if (from === "cancelling") return to === "cancelled" || to === "failed";
  return from === "deleting" && to === "deleted";
};
