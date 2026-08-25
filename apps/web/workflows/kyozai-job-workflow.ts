export type KyozaiWorkflowInput = {
  dispatchId: string;
  jobId: string;
  revisionId: string;
};

/**
 * Durable orchestration boundary. Keep this function free of I/O: Workflow SDK
 * records its state, while the isolated step below performs the database and
 * provider work and can be retried without re-running completed workflow work.
 */
export async function durableKyozaiJobWorkflow(input: KyozaiWorkflowInput): Promise<void> {
  "use workflow";

  const result = await runKyozaiJobStep(input);
  if (result === "completed") {
    await completeDispatchStep(input.dispatchId);
  } else {
    await requeueDispatchStep(input.dispatchId, result);
  }
}

async function runKyozaiJobStep(input: KyozaiWorkflowInput): Promise<"completed" | string> {
  "use step";

  // Workflow functions are deterministic coordinators. Importing the worker in
  // a step keeps Supabase, storage, and model calls outside that boundary.
  try {
    const { runKyozaiJobWorkflow } = await import("../lib/kyozai/job-workflow");
    await runKyozaiJobWorkflow(input.jobId, input.revisionId);
    return "completed";
  } catch (error) {
    return error instanceof Error ? error.message : "workflow_step_failed";
  }
}

async function completeDispatchStep(dispatchId: string): Promise<void> {
  "use step";

  const { completeWorkflowDispatch } = await import("../lib/kyozai/internal-dispatch");
  await completeWorkflowDispatch(dispatchId);
}

async function requeueDispatchStep(dispatchId: string, errorCode: string): Promise<void> {
  "use step";

  const { requeueWorkflowDispatch } = await import("../lib/kyozai/internal-dispatch");
  await requeueWorkflowDispatch(dispatchId, errorCode);
}
