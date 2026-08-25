import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = (file: string) => new URL(`../../../${file}`, import.meta.url);

describe("durable deletion cleanup contract", () => {
  it("leases deletion, removes private paths, then records the terminal state", () => {
    const migration = readFileSync(root("supabase/migrations/20260825160000_kyozai_deletion_cleanup.sql"), "utf8");
    const worker = readFileSync(root("apps/web/lib/kyozai/deletion-cleanup.ts"), "utf8");
    const route = readFileSync(root("apps/web/app/api/internal/jobs/cleanup/route.ts"), "utf8");
    expect(migration).toContain("claim_kyozai_deletion_cleanup");
    expect(migration).toContain("complete_kyozai_deletion_cleanup");
    expect(worker).toContain('from("kyozai-sources").remove');
    expect(worker).toContain('from("kyozai-artifacts").remove');
    expect(worker.indexOf("deletion_cleanup_storage_failed")).toBeLessThan(worker.indexOf("complete_kyozai_deletion_cleanup"));
    expect(route).toContain("isAuthorizedCronRequest(request)");
    expect(route).toContain("runOneDeletionCleanup()");
  });
});
