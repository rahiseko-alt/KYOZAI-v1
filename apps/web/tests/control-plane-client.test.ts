import { describe, expect, it, vi } from "vitest";

import { getControlPlaneArtifactBytes, putControlPlaneArtifactBytes, sendControlPlaneCommand, sendControlPlaneJobCommand } from "../lib/kyozai/control-plane-client";
import { writePrivateControlPlaneArtifact } from "../lib/kyozai/control-plane-artifacts";

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

  it("keeps private artifact bytes behind the server-side bearer boundary", async () => {
    const put = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ artifactId: "artifact-1", byteSize: 3 }), { status: 200 }));
    await expect(putControlPlaneArtifactBytes("artifact-1", Buffer.from("abc"), "text/plain", env, put)).resolves.toEqual({ artifactId: "artifact-1", byteSize: 3 });
    expect(put).toHaveBeenCalledWith("https://control.example/internal/v1/artifacts/artifact-1/bytes", expect.objectContaining({ method: "PUT", headers: expect.objectContaining({ Authorization: "Bearer test-only-token" }) }));
    await expect(getControlPlaneArtifactBytes("artifact-1", env, vi.fn<typeof fetch>().mockResolvedValue(new Response("abc", { status: 200 })))).resolves.toEqual(Buffer.from("abc"));
  });

  it("validates a private artifact only after byte-for-byte readback", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ artifactId: "artifact-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ artifactId: "artifact-1", byteSize: 3 }), { status: 200 }))
      .mockResolvedValueOnce(new Response("abc", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ artifactId: "artifact-1" }), { status: 200 }));
    await expect(writePrivateControlPlaneArtifact({ jobId: "job-1", revisionId: "revision-1", kind: "deck_spec", storageBucket: "kyozai-artifacts", storagePath: "job-1/draft.json", mediaType: "application/json", bytes: Buffer.from("abc"), metadata: {}, now: "2026-08-28T00:00:00.000Z", artifactId: "artifact-1" }, env, fetcher)).resolves.toMatchObject({ artifactId: "artifact-1", bytes: Buffer.from("abc") });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://control.example/internal/v1/artifacts/commands", "https://control.example/internal/v1/artifacts/artifact-1/bytes",
      "https://control.example/internal/v1/artifacts/artifact-1/bytes", "https://control.example/internal/v1/artifacts/commands",
    ]);
  });

  it("does not validate an artifact when private R2 readback changes its bytes", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ artifactId: "artifact-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ artifactId: "artifact-1", byteSize: 3 }), { status: 200 }))
      .mockResolvedValueOnce(new Response("abd", { status: 200 }));
    await expect(writePrivateControlPlaneArtifact({ jobId: "job-1", revisionId: "revision-1", kind: "deck_spec", storageBucket: "kyozai-artifacts", storagePath: "job-1/draft.json", mediaType: "application/json", bytes: Buffer.from("abc"), metadata: {}, now: "2026-08-28T00:00:00.000Z", artifactId: "artifact-1" }, env, fetcher)).rejects.toThrow("artifact_readback_hash_mismatch");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
