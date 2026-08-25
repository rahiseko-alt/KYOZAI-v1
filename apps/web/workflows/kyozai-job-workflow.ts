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
    const { slideCount } = await runContentStep(input);
    for (let slideNumber = 1; slideNumber <= slideCount; slideNumber += 1) await runSlideStep(input, slideNumber);
    await runPackageStep(input);
    return "completed";
  } catch (error) {
    return error instanceof Error ? error.message : "workflow_step_failed";
  }
}

async function runContentStep(input: KyozaiWorkflowInput): Promise<{ slideCount: number }> {
  "use step";
  const { runKyozaiContentStages } = await import("../lib/kyozai/job-workflow");
  return runKyozaiContentStages(input.jobId, input.revisionId);
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
