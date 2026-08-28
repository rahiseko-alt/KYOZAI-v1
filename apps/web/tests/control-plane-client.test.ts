import { describe, expect, it, vi } from "vitest";

import { sendControlPlaneCommand, sendControlPlaneJobCommand } from "../lib/kyozai/control-plane-client";

const env = { KYOZAI_CONTROL_PLANE_URL: "https://control.example", KYOZAI_CONTROL_PLANE_TOKEN: "test-only-token" };

describe("Cloudflare control-plane client", () => {
  it("uses the server token only in the internal Bearer header", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ jobs: [] }), { status: 200 }));
    await expect(sendControlPlaneJobCommand({ command: "list", ownerId: "access-user@example.test" }, env, fetcher)).resolves.toEqual({ jobs: [] });
    expect(fetcher).toHaveBeenCalledWith("https://control.example/internal/v1/jobs/commands", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer test-only-token" }), cache: "no-store",
    }));
  });

  it("fails closed when the gateway is unavailable", async () => {
    await expect(sendControlPlaneJobCommand({ command: "list", ownerId: "access-user@example.test" }, env, vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"))))
      .rejects.toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
  });

  it("routes typed state commands to their matching internal resource", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ settled: 0 }), { status: 200 }));
    await expect(sendControlPlaneCommand("jobs", { command: "settlePendingCancellations", now: "2026-08-28T00:00:00.000Z" }, env, fetcher)).resolves.toEqual({ settled: 0 });
    expect(fetcher).toHaveBeenCalledWith("https://control.example/internal/v1/jobs/commands", expect.any(Object));
  });
});
