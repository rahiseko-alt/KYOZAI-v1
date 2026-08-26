export type G1FaultPoint = "provider_response_received" | "provider_checkpoint_saved" | "before_stage_pass";

type FaultContext = { stageAttempt?: number };

export function injectG1Fault(point: G1FaultPoint, context: FaultContext = {}, env: Record<string, string | undefined> = process.env) {
  if (env.VERCEL_ENV !== "preview" || env.KYOZAI_G1_FAULT_INJECTION_ENABLED !== "1"
    || env.KYOZAI_G1_FAULT_POINT !== point) return;
  if (point === "before_stage_pass" && context.stageAttempt !== 0) return;
  if (point === "provider_checkpoint_saved") throw new Error("provider_checkpoint_fault_injected");
  throw new Error(`fault_injected:${point}`);
}
