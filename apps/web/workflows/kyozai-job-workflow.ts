export type KyozaiWorkflowInput = {
  dispatchId: string;
  jobId: string;
  revisionId: string;
  leaseOwner: string;
};

/**
 * Durable orchestration boundary. Keep this function free of I/O: Workflow SDK
 * records its state, while the isolated step below performs the database and
 * provider work and can be retried without re-running completed workflow work.
 */
export async function durableKyozaiJobWorkflow(input: KyozaiWorkflowInput): Promise<void> {
  "use workflow";

  const result = await runDurableStages(input);
  if (result === "completed") {
    await completeDispatchStep(input.dispatchId, input.leaseOwner);
  } else {
    await requeueDispatchStep(input.dispatchId, input.leaseOwner, result);
  }
}

async function runDurableStages(input: KyozaiWorkflowInput): Promise<"completed" | string> {
  try {
    let slideCount = 0;
    for (const stage of ["source_ingest", "analysis", "slide_map", "script_timing", "content_freeze", "design"] as const) {
      await renewLeaseStep(input);
      const content = await runContentStep(input, stage);
      if (content) slideCount = content.slideCount;
    }
    for (let slideNumber = 1; slideNumber <= slideCount; slideNumber += 1) {
      await renewLeaseStep(input);
      await runSlideStep(input, slideNumber);
    }
    await renewLeaseStep(input);
    await runPackageStep(input);
    return "completed";
  } catch (error) {
    return error instanceof Error ? error.message : "workflow_step_failed";
  }
}

async function runContentStep(input: KyozaiWorkflowInput, stage: "source_ingest" | "analysis" | "slide_map" | "script_timing" | "content_freeze" | "design"): Promise<{ slideCount: number } | undefined> {
  "use step";
  const { runKyozaiContentStage } = await import("../lib/kyozai/job-workflow");
  return runKyozaiContentStage(input.jobId, input.revisionId, stage);
}

async function runSlideStep(input: KyozaiWorkflowInput, slideNumber: number): Promise<void> {
  "use step";
  const { runKyozaiSlideStage } = await import("../lib/kyozai/job-workflow");
  await runKyozaiSlideStage(input.jobId, input.revisionId, slideNumber);
}

async function runPackageStep(input: KyozaiWorkflowInput): Promise<void> {
  "use step";
  const { runKyozaiPackagingStage } = await import("../lib/kyozai/job-workflow");
  await runKyozaiPackagingStage(input.jobId, input.revisionId);
}

async function renewLeaseStep(input: KyozaiWorkflowInput): Promise<void> {
  "use step";
  const { renewWorkflowDispatchLease } = await import("../lib/kyozai/internal-dispatch");
  await renewWorkflowDispatchLease(input.dispatchId, input.leaseOwner);
}

async function completeDispatchStep(dispatchId: string, leaseOwner: string): Promise<void> {
  "use step";

  const { completeWorkflowDispatch } = await import("../lib/kyozai/internal-dispatch");
  await completeWorkflowDispatch(dispatchId, leaseOwner);
}

async function requeueDispatchStep(dispatchId: string, leaseOwner: string, errorCode: string): Promise<void> {
  "use step";

  const { requeueWorkflowDispatch } = await import("../lib/kyozai/internal-dispatch");
  await requeueWorkflowDispatch(dispatchId, leaseOwner, errorCode);
}
