import { finalizePackage, isBusyStageError, loadExecutableJob, loadOrCreatePackage, markJobCompleted, markWorkflowFailed, renderSlides } from "./job-workflow";

/** A Workflow step may run this repeatedly; completed content artifacts are reused. */
export async function runKyozaiContentStages(jobId: string, revisionId: string): Promise<{ slideCount: number }> {
  const job = await loadExecutableJob(jobId);
  if (!job) return { slideCount: 0 };
  try {
    const teachingPackage = await loadOrCreatePackage(jobId, revisionId, job.request_json as Record<string, unknown>);
    return { slideCount: teachingPackage.slides.length };
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
