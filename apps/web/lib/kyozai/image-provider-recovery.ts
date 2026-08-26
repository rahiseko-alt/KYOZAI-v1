import { PublicHttpError } from "./http-errors";
import { injectG1Fault } from "./g1-fault-injection";
import { IMAGE_MODELS, type ImageModelId } from "./image-models";
import {
  beginProviderAttempt,
  confirmProviderAttempt,
  markProviderAttemptAmbiguous,
  releaseProviderAttempt,
} from "./provider-attempt";

export type RecoverableSourceImage = {
  bytes: Buffer;
  format: "jpeg" | "png";
  providerModel: string;
  providerQuality: "1K" | "medium";
};
export type RecoverableVisualReview = { passed: boolean; issues: string[]; checks: string[] };
type SourceImageCheckpoint = Omit<RecoverableSourceImage, "bytes"> & { data: string };

function shouldRelease(error: unknown) {
  return error instanceof PublicHttpError && error.code !== "TIMEOUT";
}

function isRecoveryError(error: unknown) {
  return error instanceof Error && (
    error.message.startsWith("provider_result_unavailable:")
    || error.message.startsWith("provider_checkpoint_")
    || error.message === "provider_attempt_settlement_failed"
  );
}

async function settleFailure(attempt: Awaited<ReturnType<typeof beginProviderAttempt>>, error: unknown) {
  if (isRecoveryError(error)) return;
  if (shouldRelease(error)) await releaseProviderAttempt(attempt);
  else await markProviderAttemptAmbiguous(attempt);
}

function recoverSource(bytes: Buffer): RecoverableSourceImage {
  let checkpoint: SourceImageCheckpoint;
  try {
    checkpoint = JSON.parse(bytes.toString("utf8")) as SourceImageCheckpoint;
  } catch {
    throw new Error("provider_checkpoint_image_invalid");
  }
  if (!checkpoint || typeof checkpoint.data !== "string" || checkpoint.data.length < 100
    || (checkpoint.format !== "jpeg" && checkpoint.format !== "png")
    || typeof checkpoint.providerModel !== "string"
    || (checkpoint.providerQuality !== "1K" && checkpoint.providerQuality !== "medium")) {
    throw new Error("provider_checkpoint_image_invalid");
  }
  return { ...checkpoint, bytes: Buffer.from(checkpoint.data, "base64") };
}

function recoverReview(bytes: Buffer): RecoverableVisualReview {
  let review: RecoverableVisualReview;
  try {
    review = JSON.parse(bytes.toString("utf8")) as RecoverableVisualReview;
  } catch {
    throw new Error("provider_checkpoint_qa_invalid");
  }
  if (typeof review.passed !== "boolean" || !Array.isArray(review.issues) || !Array.isArray(review.checks)) {
    throw new Error("provider_checkpoint_qa_invalid");
  }
  return review;
}

export async function runTrackedImageGeneration(
  modelId: ImageModelId,
  slideNumber: number,
  attemptNumber: number,
  call: () => Promise<RecoverableSourceImage>,
) {
  const attempt = await beginProviderAttempt({
    operation: "image_generation",
    provider: IMAGE_MODELS[modelId].provider,
    model: modelId,
    logicalAttempt: `slide-${slideNumber}:image-${attemptNumber}`,
    imageCount: 1,
  });
  if (attempt.tracked && attempt.recovered) return recoverSource(attempt.recovered);
  try {
    const source = await call();
    injectG1Fault("provider_response_received");
    const checkpoint: SourceImageCheckpoint = { ...source, data: source.bytes.toString("base64") };
    await confirmProviderAttempt(attempt, Buffer.from(JSON.stringify(checkpoint)));
    return source;
  } catch (error) {
    await settleFailure(attempt, error);
    throw error;
  }
}

export async function runTrackedImageQa(
  model: string,
  slideNumber: number,
  imageAttemptNumber: number,
  call: () => Promise<RecoverableVisualReview>,
) {
  const attempt = await beginProviderAttempt({
    operation: "image_qa",
    provider: "openai",
    model,
    logicalAttempt: `slide-${slideNumber}:image-${imageAttemptNumber}`,
  });
  if (attempt.tracked && attempt.recovered) return recoverReview(attempt.recovered);
  try {
    const review = await call();
    injectG1Fault("provider_response_received");
    await confirmProviderAttempt(attempt, Buffer.from(JSON.stringify(review)));
    return review;
  } catch (error) {
    await settleFailure(attempt, error);
    throw error;
  }
}
