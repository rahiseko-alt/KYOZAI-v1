import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260825130000_kyozai_worker_coordination.sql", import.meta.url),
  "utf8",
);
const constraintFix = readFileSync(
  new URL("../../../supabase/migrations/20260825131000_fix_stage_run_started_at_constraint.sql", import.meta.url),
  "utf8",
);
const dispatchCompletion = readFileSync(
  new URL("../../../supabase/migrations/20260825140100_complete_kyozai_workflow_dispatch_function.sql", import.meta.url),
  "utf8",
);
const dispatchStatus = readFileSync(
  new URL("../../../supabase/migrations/20260825140000_complete_kyozai_workflow_dispatch.sql", import.meta.url),
  "utf8",
);
const terminalDispatchSettlement = readFileSync(
  new URL("../../../supabase/migrations/20260825140200_settle_failed_kyozai_workflow_dispatch.sql", import.meta.url),
  "utf8",
);

describe("永続workerのDB契約", () => {
  it("lease、artifact昇格、cancel、outbox retryを原子的RPCとして提供する", () => {
    for (const name of [
      "claim_kyozai_stage_run",
      "pass_kyozai_stage_run",
      "fail_kyozai_stage_run",
      "promote_kyozai_artifacts_to_final",
      "request_kyozai_job_cancellation",
      "settle_kyozai_job_cancellation",
      "claim_next_kyozai_workflow_dispatch",
      "requeue_kyozai_workflow_dispatch",
      "complete_kyozai_workflow_dispatch",
    ]) {
      const source = name === "complete_kyozai_workflow_dispatch" ? dispatchCompletion : migration;
      expect(source).toContain(`create or replace function public.${name}`);
      expect(source).toContain(`grant execute on function public.${name}`);
    }
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("lease_expires_at <= timezone('utc', now())");
    expect(migration).toContain("lifecycle = 'validated'");
    expect(constraintFix).toContain("stage_runs_started_at_lifecycle_check");
    expect(constraintFix).toContain("status in ('running', 'passed', 'failed', 'skipped')");
  });

  it("成功したworker dispatchをcompletedへ確定する", () => {
    expect(dispatchStatus).toContain("add value if not exists 'completed'");
    expect(dispatchCompletion).toContain("v_job.status = 'completed'");
    expect(dispatchCompletion).toContain("set status = 'completed'");
  });

  it("失敗済みjobのoutboxを再配送せずfailedで確定する", () => {
    expect(terminalDispatchSettlement).toContain("v_job.status = 'failed'");
    expect(terminalDispatchSettlement).toContain("set status = 'failed'");
  });

  it("worker RPCをブラウザ利用者へ付与しない", () => {
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).not.toContain("to authenticated;");
    expect(migration).toContain("to service_role;");
  });
});
