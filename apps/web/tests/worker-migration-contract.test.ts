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
    ]) {
      expect(migration).toContain(`create or replace function public.${name}`);
      expect(migration).toContain(`grant execute on function public.${name}`);
    }
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("lease_expires_at <= timezone('utc', now())");
    expect(migration).toContain("lifecycle = 'validated'");
    expect(constraintFix).toContain("stage_runs_started_at_lifecycle_check");
    expect(constraintFix).toContain("status in ('running', 'passed', 'failed', 'skipped')");
  });

  it("worker RPCをブラウザ利用者へ付与しない", () => {
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).not.toContain("to authenticated;");
    expect(migration).toContain("to service_role;");
  });
});
