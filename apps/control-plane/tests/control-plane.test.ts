import { describe, expect, it, vi } from "vitest";

import { handleControlPlaneRequest, invokeScheduler, scheduledKind, type ControlPlaneEnv } from "../src";
import { executeJobCommand, parseJobCommand } from "../src/job-commands";

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

  it("accepts the Vercel control token with standard Bearer whitespace", async () => {
    const request = new Request("https://control.example/internal/v1/jobs/commands", {
      method: "POST", headers: { Authorization: "Bearer test-control-token" }, body: JSON.stringify({ command: "drop" }),
    });
    const response = await handleControlPlaneRequest(request, environment());
    expect(response.status).toBe(400);
  });

  it("accepts only typed gateway commands before any D1 statement is issued", () => {
    expect(parseJobCommand({ command: "list", ownerId: "access-user@example.test" })).toEqual({ command: "list", ownerId: "access-user@example.test" });
    expect(() => parseJobCommand({ command: "drop", ownerId: "access-user@example.test" })).toThrow("BAD_COMMAND");
    expect(() => parseJobCommand({ command: "read", ownerId: "access-user@example.test" })).toThrow("BAD_COMMAND");
  });

  it("lists jobs through the gateway with an owner-scoped D1 query", async () => {
    const all = vi.fn(async () => ({ results: [{ id: "job-1", status: "queued" }] }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    const result = await executeJobCommand({ prepare } as unknown as D1Database, { command: "list", ownerId: "access-user@example.test" });
    expect(result).toEqual({ jobs: [{ id: "job-1", status: "queued" }] });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("owner_id = ?"));
    expect(bind).toHaveBeenCalledWith("access-user@example.test");
  });

  it("returns the original job for an identical idempotent create request", async () => {
    const first = vi.fn(async () => ({ id: "job-original", input_kind: "text", request_json: "{\"request\":\"教材にする\"}", image_model: "gpt-image-1" }));
    const bind = vi.fn(() => ({ first }));
    const db = { prepare: vi.fn(() => ({ bind })) } as unknown as D1Database;
    const result = await executeJobCommand(db, parseJobCommand({
      command: "create", ownerId: "access-user@example.test", jobId: "job-new", revisionId: "revision-new", dispatchId: "dispatch-new", reservationId: "reservation-new", idempotencyKey: "request-1", inputKind: "text", requestJson: "{\"request\":\"教材にする\"}", imageModel: "gpt-image-1", workflowVersion: "kyozai-workflow@1", now: "2026-08-28T00:00:00.000Z", expiresAt: "2026-09-04T00:00:00.000Z", reservationExpiresAt: "2026-08-29T00:00:00.000Z", reservedImageCalls: 24, reservedCostUnits: 57,
    }));
    expect(result).toEqual({ jobId: "job-original", idempotent: true });
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
