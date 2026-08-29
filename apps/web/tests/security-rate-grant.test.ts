import { afterEach, describe, expect, it, vi } from "vitest";

import { mockPackage } from "../lib/kyozai/mock";
import { e2eEphemeralSecret, isE2eRuntimeAllowed } from "../lib/kyozai/e2e-runtime";
import { enforceRateLimit } from "../lib/kyozai/rate-limit";
import { issueRenderGrant, verifyRenderGrant } from "../lib/kyozai/render-grant";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("画像生成grantの鍵分離", () => {
  it("OPENAI_API_KEYを署名鍵として流用しない", () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key-that-must-never-sign-a-render-grant");
    vi.stubEnv("KYOZAI_RENDER_GRANT_SECRET", "");
    vi.stubEnv("KYOZAI_E2E_MODE", "0");
    expect(() => issueRenderGrant(mockPackage, "gpt-image-2-medium")).toThrow("署名設定がありません");
  });

  it("32バイト未満の専用鍵を拒否し、v2だけを発行する", () => {
    vi.stubEnv("KYOZAI_RENDER_GRANT_SECRET", "too-short");
    expect(() => issueRenderGrant(mockPackage, "gpt-image-2-medium")).toThrow("署名設定が不正");
    vi.stubEnv("KYOZAI_RENDER_GRANT_SECRET", "current-render-grant-secret-with-at-least-32-bytes");
    const grant = issueRenderGrant(mockPackage, "gpt-image-2-medium");
    const [payload] = grant.split(".");
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"))).toMatchObject({ version: 2 });
  });

  it("鍵交換中は旧鍵を検証にだけ使う", () => {
    const previous = "previous-render-grant-secret-with-at-least-32-bytes";
    const current = "current-render-grant-secret-with-at-least-32-bytes";
    vi.stubEnv("KYOZAI_RENDER_GRANT_SECRET", previous);
    const oldGrant = issueRenderGrant(mockPackage, "gpt-image-2-medium");
    vi.stubEnv("KYOZAI_RENDER_GRANT_SECRET", current);
    vi.stubEnv("KYOZAI_RENDER_GRANT_SECRET_PREVIOUS", previous);
    expect(() => verifyRenderGrant(oldGrant, mockPackage, "gpt-image-2-medium")).not.toThrow();
    const newGrant = issueRenderGrant(mockPackage, "gpt-image-2-medium");
    vi.stubEnv("KYOZAI_RENDER_GRANT_SECRET", previous);
    vi.stubEnv("KYOZAI_RENDER_GRANT_SECRET_PREVIOUS", "");
    expect(() => verifyRenderGrant(newGrant, mockPackage, "gpt-image-2-medium")).toThrow("検証できません");
  });

  it("productionではE2E runtimeと署名鍵を使用できない", () => {
    vi.stubEnv("KYOZAI_E2E_MODE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("KYOZAI_PERSONAL_PWA_ENABLED", "0");
    vi.stubEnv("KYOZAI_RENDER_GRANT_SECRET", "");
    expect(isE2eRuntimeAllowed()).toBe(false);
    expect(e2eEphemeralSecret()).toBeUndefined();
    expect(() => issueRenderGrant(mockPackage, "gpt-image-2-medium")).toThrow("署名設定がありません");
  });

  it("個人PWAでは署名鍵なしで短期package bindingを発行する", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("KYOZAI_PERSONAL_PWA_ENABLED", "1");
    vi.stubEnv("KYOZAI_RENDER_GRANT_SECRET", "");
    const grant = issueRenderGrant(mockPackage, "gpt-image-2-medium");
    expect(grant).toMatch(/^pwa\.[A-Za-z0-9_-]+$/);
    expect(() => verifyRenderGrant(grant, mockPackage, "gpt-image-2-medium")).not.toThrow();
    expect(() => verifyRenderGrant(grant, mockPackage, "gemini-3.1-flash-lite-image")).toThrow("一致しません");
  });

  it("Preview E2Eの鍵はprocess内でのみ生成され、公開固定値を持たない", () => {
    vi.stubEnv("KYOZAI_E2E_MODE", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    const secret = e2eEphemeralSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(e2eEphemeralSecret()).toBe(secret);
    expect(secret).not.toContain("kyozai-e2e");
  });
});

describe("分散レート制限", () => {
  const productionRequest = () => new Request("https://example.test/api/generate", {
    headers: { "x-vercel-forwarded-for": "203.0.113.10" },
  });

  function productionEnv() {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("KYOZAI_E2E_MODE", "0");
    vi.stubEnv("KYOZAI_RATE_LIMIT_ID_SECRET", "rate-limit-id-secret-with-at-least-32-bytes");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "server-token-placeholder");
  }

  it("Redisの原子的カウンタへ利用者枠と全体枠をまとめて送る", async () => {
    productionEnv();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ result: [1, 1, 900_000, 86_400_000] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(enforceRateLimit(productionRequest(), "generate")).resolves.toBeUndefined();
    const command = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as string[];
    expect(command.slice(0, 3)).toEqual(["EVAL", expect.any(String), "2"]);
    expect(command.some((value) => value.includes("203.0.113.10"))).toBe(false);
    expect(command).toContain("kyozai:rate:generate:global");
  });

  it("上限超過を429とRetry-Afterへ変換する", async () => {
    productionEnv();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ result: [4, 1, 120_000, 86_400_000] }), { status: 200 })));
    await expect(enforceRateLimit(productionRequest(), "generate")).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 120,
    });
  });

  it("Redis設定不足・障害・信頼済み転送ヘッダー不足ではfail closedにする", async () => {
    productionEnv();
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    await expect(enforceRateLimit(productionRequest(), "generate")).rejects.toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "server-token-placeholder");
    await expect(enforceRateLimit(new Request("https://example.test/api/generate"), "generate")).rejects.toMatchObject({ status: 503 });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("network unavailable")));
    await expect(enforceRateLimit(productionRequest(), "generate")).rejects.toMatchObject({ status: 503 });
  });

  it("Redisが壊れたカウンタまたはTTLを返したら、課金経路を503で停止する", async () => {
    productionEnv();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      result: ["not-a-number", 1, 900_000, 86_400_000],
    }), { status: 200 })));
    await expect(enforceRateLimit(productionRequest(), "generate")).rejects.toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });

    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      result: [1, 1, -1, 86_400_000],
    }), { status: 200 })));
    await expect(enforceRateLimit(productionRequest(), "generate")).rejects.toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("個人PWAのProductionは共有Redisなしでプロセス内制限を使う", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("KYOZAI_PERSONAL_PWA_ENABLED", "1");
    vi.stubEnv("PROCESS_PARITY_PIPELINE_ENABLED", "1");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());
    const request = new Request("https://example.test/api/generate", {
      headers: { "x-forwarded-for": "198.51.100.77" },
    });
    await expect(enforceRateLimit(request, "generate")).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("render-slideはgrantとslideの再試行枠も同じ原子操作に含める", async () => {
    productionEnv();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ result: [1, 1, 1, 900_000, 86_400_000, 900_000] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await enforceRateLimit(productionRequest(), "render-slide", { renderGrant: "signed-grant", slideNumber: 3 });
    const command = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as string[];
    expect(command[2]).toBe("3");
    expect(command.some((value) => value.includes("signed-grant"))).toBe(false);
    expect(command.some((value) => value.endsWith(":3"))).toBe(true);
  });

  it("3 bucket応答をcount 3件、TTL 3件の順で判定する", async () => {
    productionEnv();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      result: [1, 1, 3, 900_000, 86_400_000, 45_000],
    }), { status: 200 })));
    await expect(enforceRateLimit(productionRequest(), "render-slide", {
      renderGrant: "signed-grant",
      slideNumber: 3,
    })).rejects.toMatchObject({ status: 429, retryAfterSeconds: 45 });
  });
});
