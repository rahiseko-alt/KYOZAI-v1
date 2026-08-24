import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as generate } from "../app/api/generate/route";
import { POST as renderSlide } from "../app/api/render-slide/route";
import { POST as revise } from "../app/api/revise/route";
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
