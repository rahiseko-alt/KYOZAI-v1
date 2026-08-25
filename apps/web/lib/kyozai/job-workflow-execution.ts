import { finalizePackage, isBusyStageError, loadExecutableJob, loadOrCreatePackage, markJobCompleted, markWorkflowFailed, renderSlides } from "./job-workflow";
import { DURABLE_CONTENT_STAGES, type DurableContentStage } from "./durable-stages";

/** A Workflow step may run this repeatedly; completed content artifacts are reused. */
export async function runKyozaiContentStages(jobId: string, revisionId: string): Promise<{ slideCount: number }> {
  for (const stage of DURABLE_CONTENT_STAGES) {
    const result = await runKyozaiContentStage(jobId, revisionId, stage);
    if (result) return result;
  }
  throw new Error("content_design_unavailable");
}

export const CONTENT_STAGES = DURABLE_CONTENT_STAGES;

/** Exactly one content contract stage per Workflow step. */
export async function runKyozaiContentStage(jobId: string, revisionId: string, stage: DurableContentStage): Promise<{ slideCount: number } | undefined> {
  const job = await loadExecutableJob(jobId);
  if (!job) return { slideCount: 0 };
  try {
    const teachingPackage = await loadOrCreatePackage(jobId, revisionId, job.request_json as Record<string, unknown>, stage);
    return teachingPackage ? { slideCount: teachingPackage.slides.length } : undefined;
  } catch (error) {
    if (!isBusyStageError(error)) await markWorkflowFailed(jobId);
    throw error;
  }
}

/** One image/QA pair per durable Workflow step, never a 12-page monolith. */
export async function runKyozaiSlideStage(jobId: string, revisionId: string, slideNumber: number): Promise<void> {
  const job = await loadExecutableJob(jobId);
  if (!job) return;
  try {
    const teachingPackage = await loadOrCreatePackage(jobId, revisionId, job.request_json as Record<string, unknown>);
    if (!teachingPackage) throw new Error("workflow_design_unavailable");
    const slide = teachingPackage.slides.find((candidate) => candidate.number === slideNumber);
    if (!slide) throw new Error("workflow_slide_not_found");
    await renderSlides(jobId, revisionId, teachingPackage, job.image_model, [slide]);
  } catch (error) {
    if (!isBusyStageError(error)) await markWorkflowFailed(jobId);
    throw error;
  }
}

/** Package only after every independently durable image stage has passed. */
export async function runKyozaiPackagingStage(jobId: string, revisionId: string): Promise<void> {
  const job = await loadExecutableJob(jobId);
  if (!job) return;
  try {
    const teachingPackage = await loadOrCreatePackage(jobId, revisionId, job.request_json as Record<string, unknown>);
    if (!teachingPackage) throw new Error("workflow_design_unavailable");
    const images = await renderSlides(jobId, revisionId, teachingPackage, job.image_model);
    await finalizePackage(jobId, revisionId, teachingPackage, images);
    await markJobCompleted(jobId, revisionId);
  } catch (error) {
    if (!isBusyStageError(error)) await markWorkflowFailed(jobId);
    throw error;
  }
}

/** Local/test entrypoint; the deployed Workflow uses the three functions above. */
export async function runKyozaiJobWorkflow(jobId: string, revisionId: string): Promise<void> {
  const { slideCount } = await runKyozaiContentStages(jobId, revisionId);
  for (let slideNumber = 1; slideNumber <= slideCount; slideNumber += 1) await runKyozaiSlideStage(jobId, revisionId, slideNumber);
  await runKyozaiPackagingStage(jobId, revisionId);
}
