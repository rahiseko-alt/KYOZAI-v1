import { createHash } from "node:crypto";

import { createServerSupabaseClient } from "../supabase/server";
import type { ImageModelId } from "./image-models";
import type { Slide, TeachingPackage } from "./types";

export async function reserveLogicalImageCall(jobId: string, revisionId: string, stageRunId: string, modelId: ImageModelId, teachingPackage: TeachingPackage, slide: Slide) {
  const requestFingerprint = createHash("sha256").update(JSON.stringify({
    revisionId,
    slideNumber: slide.number,
    modelId,
    slide,
    designProfile: teachingPackage.designProfile,
  })).digest("hex");
  const supabase = createServerSupabaseClient();
  const prior = await supabase.from("usage_events").select("charge_state")
    .eq("job_id", jobId).eq("request_fingerprint", requestFingerprint).maybeSingle();
  if (prior.error) throw new Error("provider_usage_lookup_failed");
  if (prior.data) throw new Error(`provider_result_recovery_required:${prior.data.charge_state}`);
  const reservation = await supabase.rpc("reserve_kyozai_image_call", {
    p_job_id: jobId,
    p_revision_id: revisionId,
    p_stage_run_id: stageRunId,
    p_model: modelId,
    p_request_fingerprint: requestFingerprint,
  });
  if (reservation.error || reservation.data !== true) throw new Error("provider_budget_unavailable");
  return requestFingerprint;
}
