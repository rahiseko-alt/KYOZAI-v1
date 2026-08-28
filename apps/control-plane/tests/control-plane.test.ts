import { describe, expect, it, vi } from "vitest";

import { handleControlPlaneRequest, invokeScheduler, scheduledKind, type ControlPlaneEnv } from "../src";
import { executeJobCommand, parseJobCommand } from "../src/job-commands";
import { parseStageCommand } from "../src/stage-commands";
import { parseArtifactCommand } from "../src/artifact-commands";
import { putArtifactBytes } from "../src/artifact-objects";
import { parseDispatchCommand } from "../src/dispatch-commands";

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

  it("limits stage leases to the declared recovery window", () => {
    const claim = parseStageCommand({ command: "claim", stageRunId: "stage-1", leaseOwner: "workflow-1", leaseSeconds: 900, now: "2026-08-28T00:00:00.000Z", leaseExpiresAt: "2026-08-28T00:15:00.000Z" });
    expect(claim.command).toBe("claim");
    if (claim.command === "claim") expect(claim.leaseSeconds).toBe(900);
    expect(() => parseStageCommand({ command: "claim", stageRunId: "stage-1", leaseOwner: "workflow-1", leaseSeconds: 901, now: "now", leaseExpiresAt: "later" })).toThrow("BAD_COMMAND");
  });

  it("requires structured completion and retry inputs for stage commands", () => {
    expect(parseStageCommand({ command: "pass", stageRunId: "stage-1", leaseOwner: "workflow-1", outputArtifactIds: [], validator: "fixture", usageJson: "{}", now: "2026-08-28T00:00:00.000Z" }).command).toBe("pass");
    expect(() => parseStageCommand({ command: "pass", stageRunId: "stage-1", leaseOwner: "workflow-1", outputArtifactIds: [], validator: "fixture", usageJson: "not-json", now: "now" })).toThrow("BAD_COMMAND");
    expect(() => parseStageCommand({ command: "fail", stageRunId: "stage-1", leaseOwner: "workflow-1", errorCode: "FAILED", retry: true, now: "now" })).toThrow("BAD_COMMAND");
  });

  it("accepts only checksummed artifact finalization commands", () => {
    expect(parseArtifactCommand({ command: "validate", artifactId: "artifact-1", sha256: "a".repeat(64) }).command).toBe("validate");
    expect(() => parseArtifactCommand({ command: "validate", artifactId: "artifact-1", sha256: "short" })).toThrow("BAD_COMMAND");
  });

  it("stores draft bytes privately and verifies the declared R2 byte size", async () => {
    const put = vi.fn(async () => undefined);
    const head = vi.fn(async () => ({ size: 3 }));
    const db = { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: vi.fn(async () => ({ storage_bucket: "kyozai-artifacts", storage_path: "fixture/path", media_type: "text/plain", byte_size: 3 })) })) })) } as unknown as D1Database;
    const result = await putArtifactBytes(new Request("https://control.example/internal/v1/artifacts/artifact-1/bytes", { method: "PUT", body: "abc" }), db, { put, head } as unknown as R2Bucket, { put, head } as unknown as R2Bucket);
    expect(result).toEqual({ artifactId: "artifact-1", byteSize: 3 });
    expect(put).toHaveBeenCalledWith("fixture/path", expect.any(ReadableStream), expect.any(Object));
  });

  it("accepts only typed workflow dispatch lease commands", () => {
    expect(parseDispatchCommand({ command: "claim", leaseOwner: "cron-1", now: "2026-08-28T00:00:00.000Z", leaseExpiresAt: "2026-08-28T00:15:00.000Z" }).command).toBe("claim");
    expect(() => parseDispatchCommand({ command: "requeue", dispatchId: "d-1", leaseOwner: "cron-1", errorCode: "start_failed", now: "now" })).toThrow("BAD_COMMAND");
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
