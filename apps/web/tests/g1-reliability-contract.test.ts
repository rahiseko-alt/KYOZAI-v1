import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const migration = readFileSync(new URL("supabase/migrations/20260826010000_g1_provider_attempts_and_cancellation.sql", root), "utf8");
const deployedVercel = JSON.parse(readFileSync(new URL("apps/web/vercel.json", root), "utf8")) as {
  crons?: Array<{ path: string; schedule: string }>;
};

describe("G1直接入力の信頼性契約", () => {
  it("実際に配備されるapps/web設定へdispatcherとcleanup Cronを置く", () => {
    expect(deployedVercel.crons).toEqual([
      { path: "/api/internal/jobs/dispatch", schedule: "*/5 * * * *" },
      { path: "/api/internal/jobs/cleanup", schedule: "17 */6 * * *" },
    ]);
    expect(existsSync(new URL("vercel.json", root))).toBe(false);
  });

  it("本文・画像・画像QAを同じprovider試行状態機械で追跡する", () => {
    expect(migration).toContain("operation in ('text_generation', 'image_generation', 'image_qa')");
    expect(migration).toContain("create or replace function public.reserve_kyozai_provider_attempt");
    expect(migration).toContain("create or replace function public.settle_kyozai_provider_attempt");
    expect(migration).toContain("result_storage_path");
    expect(migration).toContain("inflight_cost_units");
    expect(migration).toContain("confirmed provider result requires a checkpoint");
    expect(migration).toContain("provider attempt lineage mismatch");
    expect(migration.match(/where job_id = p_job_id and request_fingerprint = p_request_fingerprint/g)).toHaveLength(3);
    expect(migration).toContain("drop function if exists public.reserve_kyozai_image_call");
    expect(migration).toContain("drop function if exists public.settle_kyozai_image_call");
    expect(migration).toContain("drop function if exists public.record_kyozai_usage");
  });

  it("期限切れstage leaseをskipし、cancelledへ有限時間で収束させる", () => {
    expect(migration).toContain("lease_expires_at <= timezone('utc', now())");
    expect(migration).toContain("lease_expires_at is null or lease_expires_at <= timezone('utc', now())");
    expect(migration).toContain("create or replace function public.settle_pending_kyozai_cancellations");
    expect(migration).toContain("j.status = 'cancelled' and q.released_at is null");
    expect(migration).toContain("update public.jobs set status = 'cancelled'");
    expect(migration).toContain("status = 'cancelled', completed_at = timezone('utc', now())");
    expect(migration).toContain("where job_id = p_job_id and charge_state = 'reserved'");
    expect(migration).toContain("when v_has_ambiguous then 'ambiguous'::public.kyozai_charge_state");
  });

  it("新しいworker RPCを利用者ロールへ公開しない", () => {
    for (const name of ["reserve_kyozai_provider_attempt", "settle_kyozai_provider_attempt", "settle_kyozai_job_cancellation", "settle_pending_kyozai_cancellations", "release_kyozai_unused_quota"]) {
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]*from public, anon, authenticated;`, "s"));
      expect(migration).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^;]*to service_role;`, "s"));
    }
  });
});
