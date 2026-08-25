import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as generate } from "../app/api/generate/route";
import { POST as renderSlide } from "../app/api/render-slide/route";
import { POST as revise } from "../app/api/revise/route";
import { POST as createJob } from "../app/api/jobs/route";
import { POST as createUpload } from "../app/api/uploads/route";
import { GET as dispatchJobs, POST as dispatchJobsManually } from "../app/api/internal/jobs/dispatch/route";
import { readBoundedText } from "../lib/kyozai/bounded-body";
import { generationIsAvailable } from "../lib/kyozai/generation-access";

describe("公開生成境界", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("productionではpipeline flagが有効でも生成を公開しない", () => {
    expect(generationIsAvailable({ VERCEL_ENV: "production", PROCESS_PARITY_PIPELINE_ENABLED: "1" })).toBe(false);
    expect(generationIsAvailable({ VERCEL_ENV: "preview", PROCESS_PARITY_PIPELINE_ENABLED: "1" })).toBe(true);
  });

  it("productionの生成・修正・画像APIをflagに関係なく拒否する", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PROCESS_PARITY_PIPELINE_ENABLED", "1");
    const requests = [
      generate(new Request("https://example.test/api/generate", { method: "POST" })),
      revise(new Request("https://example.test/api/revise", { method: "POST" })),
      renderSlide(new Request("https://example.test/api/render-slide", { method: "POST" })),
    ];
    const responses = await Promise.all(requests);
    expect(responses.map(({ status }) => status)).toEqual([404, 404, 404]);
    for (const response of responses) await expect(response.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
  });

  it("productionの永続job APIも設定や認証より先に拒否する", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("KYOZAI_ASYNC_JOBS_ENABLED", "1");
    const [job, upload, dispatch, manualDispatch] = await Promise.all([
      createJob(new Request("https://example.test/api/jobs", { method: "POST", headers: { "idempotency-key": "test" }, body: "{}" })),
      createUpload(new Request("https://example.test/api/uploads", { method: "POST", body: "{}" })),
      dispatchJobs(new Request("https://example.test/api/internal/jobs/dispatch", { headers: { authorization: "Bearer ignored" } })),
      dispatchJobsManually(new Request("https://example.test/api/internal/jobs/dispatch", { method: "POST", headers: { authorization: "Bearer ignored" } })),
    ]);
    expect(job.status).toBe(404);
    expect(upload.status).toBe(404);
    expect(dispatch.status).toBe(404);
    expect(manualDispatch.status).toBe(404);
  });

  it("chunked requestを読み切る前に実バイト上限で拒否する", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(8));
      },
      cancel() { cancelled = true; },
    });
    const request = new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(readBoundedText(request, 12, "大きすぎます")).rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect(cancelled).toBe(true);
  });
});
