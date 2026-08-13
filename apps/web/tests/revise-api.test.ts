import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/revise/route";
import { readRevisionResponse } from "../lib/kyozai/api-client";
import { mockPackage, mockRevisionPlan } from "../lib/kyozai/mock";
import { revisePackage } from "../lib/kyozai/openai";
import { applyRevisionPlan, extractRevisionScope, packageHash, REVISION_BODY_LIMIT_BYTES, RevisionError } from "../lib/kyozai/revision";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function apiResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify({
    id: crypto.randomUUID(),
    status: "completed",
    output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  }), { status, headers: { "Content-Type": "application/json" } });
}

function wireRevisionPlan(slideNumber: number) {
  const plan = structuredClone(mockRevisionPlan(mockPackage, [slideNumber])) as unknown as {
    patches: Array<{ target: Record<string, unknown> }>;
  };
  for (const patch of plan.patches) patch.target.itemIndex = null;
  return plan;
}

function revisionRequest(body: unknown, headers: HeadersInit = {}) {
  return new Request(`http://localhost/api/revise?test=${crypto.randomUUID()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": crypto.randomUUID(), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("Revise API境界", () => {
  it("E2E経路でも同じexecutorを通してcandidateだけを返す", async () => {
    vi.stubEnv("KYOZAI_E2E_MODE", "1");
    const base = structuredClone(mockPackage);
    const response = await POST(revisionRequest({ package: base, request: "このスライドの見出しを短くしてください", selectedSlideNumber: 2 }));
    const payload = await response.json() as { package: typeof mockPackage; revision: { status: string; targetSlides: number[]; baseHash: string } };

    expect(response.status).toBe(200);
    expect(payload.revision).toMatchObject({ status: "promoted", targetSlides: [2], baseHash: packageHash(base) });
    expect(payload.package.slides[1]!.title).toContain("（修正版）");
    expect(base).toEqual(mockPackage);
  });

  it("未対応指示は422と有効な旧版を返す", async () => {
    vi.stubEnv("KYOZAI_E2E_MODE", "1");
    const response = await POST(revisionRequest({ package: mockPackage, request: "教材全体を初心者向けにしてください", selectedSlideNumber: 1 }));
    const payload = await response.json() as { package: typeof mockPackage; revision: { status: string; failureCode: string } };

    expect(response.status).toBe(422);
    expect(payload.package).toEqual(mockPackage);
    expect(payload.revision).toMatchObject({ status: "rejected", failureCode: "unsupported_operation" });
  });

  it("不正JSONでは教材を応答へ含めない", async () => {
    const response = await POST(revisionRequest('{"package":'));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(payload).not.toHaveProperty("package");
  });

  it("UTF-8本文の256KiB超過を教材読込み前に拒否する", async () => {
    const response = await POST(revisionRequest("x", { "content-length": String(REVISION_BODY_LIMIT_BYTES + 1) }));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(413);
    expect(payload).not.toHaveProperty("package");
  });

  it("Content-Lengthなしでもstreamを上限到達時に中断する", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(REVISION_BODY_LIMIT_BYTES));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const request = new Request(`http://localhost/api/revise?test=${crypto.randomUUID()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": crypto.randomUUID() },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await POST(request);
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(413);
    expect(payload).not.toHaveProperty("package");
  });
});

describe("Revise provider契約", () => {
  it("field全体の言い換えを教材全体修正と誤認しない", () => {
    expect(extractRevisionScope("1枚目のテーマ全体を言い換えてください", undefined, mockPackage.slides.length)).toEqual({ targetSlides: [1] });
  });

  it("重複したtargetSlidesをexecutorでも拒否する", () => {
    const plan = mockRevisionPlan(mockPackage, [1]);
    plan.targetSlides = [1, 1];
    expect(() => applyRevisionPlan(mockPackage, [1], plan, 1)).toThrowError(RevisionError);
    try {
      applyRevisionPlan(mockPackage, [1], plan, 1);
    } catch (error) {
      expect(error).toMatchObject({ failureCode: "invalid_plan" });
    }
  });

  it("AIへ完全なTeachingPackageを送らず許可fieldだけを渡す", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(apiResponse(wireRevisionPlan(2)));
    vi.stubGlobal("fetch", fetchMock);

    await revisePackage(mockPackage, "2枚目の見出しを短くしてください");

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { model: string; store: boolean; stream: boolean; input: Array<{ content: string }> };
    const projected = body.input[0]!.content;
    expect(body).toMatchObject({ model: "gpt-5.5", store: false, stream: true });
    expect(projected).toContain('"title"');
    expect(projected).not.toContain("speakerNotes");
    expect(projected).not.toContain("scenario");
    expect(projected).not.toContain("faq");
    expect(projected).not.toContain("quiz");
  });

  it("provider不正応答を同じbaseとscopeで最大3回だけ試す", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(apiResponse({ invalid: true }));
    vi.stubGlobal("fetch", fetchMock);
    const before = structuredClone(mockPackage);

    await expect(revisePackage(mockPackage, "2枚目の見出しを短くしてください"))
      .rejects.toMatchObject({ failureCode: "provider_unavailable", attemptCount: 3, statusCode: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const inputs = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as { input: unknown });
    expect(inputs[1]!.input).toEqual(inputs[0]!.input);
    expect(inputs[2]!.input).toEqual(inputs[0]!.input);
    expect(mockPackage).toEqual(before);
  });

  it("恒久的なprovider 400は再試行しない", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(apiResponse({ error: { message: "invalid request" } }, 400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(revisePackage(mockPackage, "2枚目の見出しを短くしてください"))
      .rejects.toMatchObject({ failureCode: "provider_unavailable", attemptCount: 1, statusCode: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("利用枠不足の429は一時障害として再試行しない", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "No credits remain.", code: "insufficient_quota", type: "insufficient_quota" },
    }), { status: 429, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(revisePackage(mockPackage, "2枚目の見出しを短くしてください"))
      .rejects.toMatchObject({ failureCode: "provider_unavailable", attemptCount: 1, statusCode: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("HTTP 200のSSE errorでも利用枠不足を1回で停止する", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const event = `data: ${JSON.stringify({ type: "error", error: { message: "No credits remain.", code: "insufficient_quota" } })}\n\n`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(event, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(revisePackage(mockPackage, "2枚目の見出しを短くしてください"))
      .rejects.toMatchObject({ failureCode: "provider_unavailable", attemptCount: 1, statusCode: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("AIが返した安全拒否へ現在のattempt数を付ける", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(apiResponse({
      status: "unsupported",
      operation: null,
      targetSlides: [2],
      patches: [],
      failureCode: "unsupported_operation",
      message: "未対応です。",
    })));

    await expect(revisePackage(mockPackage, "2枚目のレイアウトを変更してください"))
      .rejects.toMatchObject({ failureCode: "unsupported_operation", attemptCount: 1 });
  });

  it("一時障害後の有効planを2回目で昇格する", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new DOMException("request timed out", "TimeoutError"))
      .mockResolvedValueOnce(apiResponse(wireRevisionPlan(2)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await revisePackage(mockPackage, "2枚目の見出しを短くしてください");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.revision.attemptCount).toBe(2);
    expect(result.package.slides[1]!.title).toContain("（修正版）");
  });
});

describe("Revise client応答", () => {
  it("途中で切れたJSONを旧版維持の案内へ変える", async () => {
    const response = new Response('{"package":', { status: 200, headers: { "Content-Type": "application/json" } });
    await expect(readRevisionResponse(response, "失敗しました")).rejects.toThrow("元の教材は維持されています");
  });

  it("promoted metadataがない200応答を採用しない", async () => {
    const response = new Response(JSON.stringify({ package: mockPackage }), { status: 200, headers: { "Content-Type": "application/json" } });
    await expect(readRevisionResponse(response, "元の教材を維持しました")).rejects.toThrow("元の教材を維持しました");
  });
});
