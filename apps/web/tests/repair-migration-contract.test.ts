import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const repairMigration = readFileSync(
  new URL("../../../supabase/migrations/20260825150000_kyozai_repair_invariants.sql", import.meta.url),
  "utf8",
);

describe("破滅前提のDB修理契約", () => {
  it("所有者には読み取りだけを残し、受理済みjobを直接変更できない", () => {
    for (const policy of ["jobs_owner_all", "revisions_owner_all", "upload_sessions_owner_all"]) {
      expect(repairMigration).toContain(`drop policy if exists ${policy}`);
    }
    expect(repairMigration).toContain("create policy jobs_owner_select on public.jobs for select");
    expect(repairMigration).toContain("create policy revisions_owner_select on public.job_revisions for select");
    expect(repairMigration).toContain("create policy upload_sessions_owner_select on public.upload_sessions for select");
    expect(repairMigration).not.toMatch(/create policy (jobs|revisions|upload_sessions)_owner_\w+ on public\.[\w_]+ for all/i);
  });

  it("dispatchをleaseとして再取得し、開始run IDを同じleaseだけが保存する", () => {
    expect(repairMigration).toContain("add column if not exists workflow_run_id text");
    expect(repairMigration).toContain("add column if not exists lease_owner text");
    expect(repairMigration).toContain("add column if not exists lease_expires_at timestamptz");
    expect(repairMigration).toContain("status = 'dispatched' and lease_expires_at <= timezone('utc', now())");
    expect(repairMigration).toContain("for update skip locked");
    expect(repairMigration).toContain("create or replace function public.record_kyozai_workflow_started");
    expect(repairMigration).toContain("lease_owner = p_lease_owner");
    expect(repairMigration).toContain("workflow_run_id is null");
    expect(repairMigration).toContain("workflow_run_id = p_workflow_run_id");
  });

  it("Provider実行はDB予算とモデル設定を原子的に検査し、usageを冪等に記録する", () => {
    expect(repairMigration).toContain("create or replace function public.assert_kyozai_provider_budget");
    expect(repairMigration).toContain("for update;");
    expect(repairMigration).toContain("v_control.allowed_models ? p_image_model");
    expect(repairMigration).toContain("v_job.image_model <> p_image_model");
    expect(repairMigration).toContain("confirmed_image_calls + p_image_calls > v_quota.reserved_image_calls");
    expect(repairMigration).toContain("create or replace function public.record_kyozai_usage");
    expect(repairMigration).toContain("where job_id = p_job_id and request_fingerprint = p_request_fingerprint");
    expect(repairMigration).toContain("create or replace function public.release_kyozai_unused_quota");
  });

  it("worker専用の修理RPCをauthenticatedへ公開しない", () => {
    for (const name of [
      "record_kyozai_workflow_started",
      "assert_kyozai_provider_budget",
      "record_kyozai_usage",
      "release_kyozai_unused_quota",
      "complete_kyozai_workflow_dispatch_v2",
      "requeue_kyozai_workflow_dispatch_v2",
    ]) {
      expect(repairMigration).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]+from public, anon, authenticated;`, "s"));
      expect(repairMigration).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^;]+to service_role;`, "s"));
    }
  });
});
