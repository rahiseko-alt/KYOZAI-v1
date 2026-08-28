import { describe, expect, it, vi } from "vitest";

import { handleControlPlaneRequest, invokeScheduler, scheduledKind, type ControlPlaneEnv } from "../src";

function environment(overrides: Partial<ControlPlaneEnv> = {}): ControlPlaneEnv {
  return {
    DB: { prepare: vi.fn(() => ({ first: vi.fn(async () => ({ ok: 1 })) })) } as unknown as D1Database,
    SOURCE_BUCKET: { head: vi.fn(async () => null) } as unknown as R2Bucket,
    ARTIFACT_BUCKET: { head: vi.fn(async () => null) } as unknown as R2Bucket,
    KYOZAI_CONTROL_PLANE_TOKEN: "test-control-token",
    ...overrides,
  };
}

describe("control plane boundary", () => {
  it("proves bindings without opening job acceptance", async () => {
    const response = await handleControlPlaneRequest(new Request("https://control.example/health"), environment());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", storage: "private", acceptingNewJobs: false });
  });

  it("fails closed if persistent bindings are unavailable", async () => {
    const response = await handleControlPlaneRequest(new Request("https://control.example/health"), environment({
      DB: { prepare: vi.fn(() => ({ first: vi.fn(async () => { throw new Error("d1 unavailable"); }) })) } as unknown as D1Database,
    }));
    expect(response.status).toBe(503);
  });

  it("hides internal paths unless the Vercel control token is present", async () => {
    const request = new Request("https://control.example/internal/v1/jobs", { method: "POST" });
    const response = await handleControlPlaneRequest(request, environment());
    expect(response.status).toBe(404);
  });

  it("maps only the declared Cron schedules and sends the scheduler credential internally", async () => {
    expect(scheduledKind("*/5 * * * *")).toBe("dispatch");
    expect(scheduledKind("17 */6 * * *")).toBe("cleanup");
    expect(scheduledKind("* * * * *")).toBeUndefined();
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const invoked = await invokeScheduler("dispatch", environment({
      KYOZAI_SCHEDULER_TOKEN: "test-scheduler-token",
      VERCEL_DISPATCH_URL: "https://preview.example/api/internal/jobs/dispatch",
    }), fetcher as unknown as typeof fetch);
    expect(invoked).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("https://preview.example/api/internal/jobs/dispatch", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer test-scheduler-token" }),
    }));
  });
});
