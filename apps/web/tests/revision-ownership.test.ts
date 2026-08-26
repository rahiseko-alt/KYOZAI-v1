import { describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("../lib/supabase/server", () => ({
  createServerSupabaseClient: () => harness.client,
}));

import { createRevisionCandidate } from "../lib/kyozai/job-store";

const user = { id: "00000000-0000-4000-8000-000000000001", email: "user@example.test" };
const jobId = "00000000-0000-4000-8000-000000000002";

describe("revisionの所有者先行確認", () => {
  it("未所有jobではartifactへ到達せず、存在しないjobと同じ404にする", async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const is = vi.fn(() => ({ maybeSingle }));
    const eqOwner = vi.fn(() => ({ is }));
    const eqId = vi.fn(() => ({ eq: eqOwner }));
    const select = vi.fn(() => ({ eq: eqId }));
    const from = vi.fn((table: string) => {
      if (table !== "jobs") throw new Error(`unexpected service-role read: ${table}`);
      return { select };
    });
    const download = vi.fn();
    harness.client = { from, storage: { from: () => ({ download }) } };

    await expect(createRevisionCandidate(user, jobId, 1, "初心者向けにする")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("jobs");
    expect(download).not.toHaveBeenCalled();
  });
});
