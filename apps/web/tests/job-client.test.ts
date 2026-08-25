import { describe, expect, it } from "vitest";

import { artifactDownloadPath, fetchJobArtifact, fetchJobSnapshot, getJobIdFromSearch, isTerminalJobStatus, pollDelayMs, writeJobIdToUrl } from "../lib/kyozai/job-client";

describe("永続jobクライアント", () => {
  it("URLから安全なjob IDだけを復元する", () => {
    expect(getJobIdFromSearch("?job=job_123-abc")).toBe("job_123-abc");
    expect(getJobIdFromSearch("?job=<script>")).toBeUndefined();
    expect(getJobIdFromSearch("")).toBeUndefined();
  });

  it("job IDを現在URLへ残す", () => {
    const location = new URL("https://example.test/workspace?view=job") as unknown as Location;
    let result = "";
    const history = { replaceState: (_state: unknown, _title: string, url?: string | URL | null) => { result = String(url); } } as unknown as History;

    writeJobIdToUrl("job_123", location, history);
    expect(result).toBe("https://example.test/workspace?view=job&job=job_123");
  });

  it("終了jobはポーリングしない", () => {
    expect(isTerminalJobStatus("completed")).toBe(true);
    expect(isTerminalJobStatus("running")).toBe(false);
    expect(pollDelayMs("queued")).toBe(3_000);
    expect(pollDelayMs("running")).toBe(2_000);
    expect(pollDelayMs("failed")).toBeUndefined();
  });

  it("成果物は署名URLを埋め込まず、所有権確認APIへ渡す", () => {
    expect(artifactDownloadPath("job_123", "artifact_456")).toBe("/api/jobs/job_123/artifacts/artifact_456");
  });

  it("成果物取得には呼出元の認証fetcherを使う", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const blob = await fetchJobArtifact("job_123", "artifact_456", async (input, init) => {
      calls.push({ input, init });
      return new Response("zip", { status: 200, headers: { "Content-Type": "application/zip" } });
    });

    expect(await blob.text()).toBe("zip");
    expect(calls[0]?.input).toBe("/api/jobs/job_123/artifacts/artifact_456");
    expect(calls[0]?.init?.credentials).toBe("same-origin");
    await expect(fetchJobArtifact("job", "artifact", async () => new Response("no", { status: 401 }))).rejects.toThrow("artifact_request_failed:401");
  });

  it("job状態だけを取得し、失敗HTTPを成功扱いしない", async () => {
    const snapshot = await fetchJobSnapshot("job_123", async () => new Response(JSON.stringify({
      id: "job_123", status: "running", revision: 1, stages: [], artifacts: [],
    }), { status: 200 }));
    expect(snapshot.status).toBe("running");

    await expect(fetchJobSnapshot("job_123", async () => new Response("no", { status: 404 }))).rejects.toThrow("job_request_failed:404");
  });
});
