import JSZip from "jszip";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/render-slide/route";
import { PublicHttpError, publicErrorResponse } from "../lib/kyozai/http-errors";
import { imagePipelineError } from "../lib/kyozai/image-pipeline-error";
import { DEFAULT_PERSONAL_PWA_IMAGE_MODEL, isImageModelId } from "../lib/kyozai/image-models";
import { buildSlideImagePrompt } from "../lib/kyozai/image-prompt";
import { mockRenderedSlide, renderValidatedSlide } from "../lib/kyozai/image-renderer";
import { imageDataUrl } from "../lib/kyozai/image-types";
import { mockPackage } from "../lib/kyozai/mock";
import { packageHtml } from "../lib/kyozai/package-html";
import { createTeachingPackageZip } from "../lib/kyozai/package-zip";
import { issueRenderGrant, verifyRenderGrant } from "../lib/kyozai/render-grant";

beforeEach(() => vi.stubEnv("PROCESS_PARITY_PIPELINE_ENABLED", "1"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("画像生成工程", () => {
  const qaResponse = (passed = true) => new Response(JSON.stringify({
    status: "completed",
    output: [{ content: [{ type: "output_text", text: JSON.stringify({ passed, issues: passed ? [] : ["文字が欠落"], checks: ["text", "layout"] }) }] }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  async function fixtureImage(width: number, height: number, format: "jpeg" | "png") {
    const source = sharp({ create: { width, height, channels: 3, background: "white" } }).composite([{
      input: Buffer.from(`<svg width="${width}" height="${height}"><rect width="${Math.floor(width / 2)}" height="${height}" fill="#075AC8"/></svg>`),
    }]);
    return format === "jpeg" ? source.jpeg().toBuffer() : source.png().toBuffer();
  }

  it("審査済みモデルだけを受け入れ、個人PWAの実証済み初期モデルを固定する", () => {
    expect(isImageModelId("gemini-3.1-flash-lite-image")).toBe(true);
    expect(isImageModelId("gemini-3.1-flash-image")).toBe(true);
    expect(isImageModelId("gpt-image-2-medium")).toBe(true);
    expect(isImageModelId("gpt-image-2-high")).toBe(false);
    expect(isImageModelId(undefined)).toBe(false);
    expect(DEFAULT_PERSONAL_PWA_IMAGE_MODEL).toBe("gpt-image-2-medium");
  });

  it("凍結した表示文字を画像promptへ一字一句含める", () => {
    const slide = mockPackage.slides[1]!;
    const prompt = buildSlideImagePrompt(mockPackage, slide);
    expect(prompt).toContain("Use case: productivity-visual / scientific-educational");
    expect(prompt).toContain("Asset type: Japanese teaching slide");
    expect(prompt).toContain("Primary request: 確定済みの1スライドを完成画像として描画");
    expect(prompt).toContain("Text (verbatim)");
    expect(prompt).toContain("Composition:");
    expect(prompt).toContain("Color palette:");
    expect(prompt).toContain("Typography:");
    expect(prompt).toContain("Constraints:");
    expect(prompt).toContain("Avoid:");
    expect(prompt).toContain("Forbidden text:");
    expect(prompt).toContain("研修の到達点");
    expect(prompt).toContain(slide.title);
    expect(prompt).toContain(slide.keyMessage);
    slide.labels.forEach((label) => expect(prompt).toContain(label));
    slide.bullets.forEach((bullet) => expect(prompt).toContain(bullet));
    expect(prompt).toContain("言い換え、翻訳、省略、文字追加をしない");
  });

  it("画像モデル未選択のAPI要求を拒否する", async () => {
    const response = await POST(new Request("http://localhost/api/render-slide", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": crypto.randomUUID() },
      body: JSON.stringify({ package: mockPackage, slideNumber: 1 }),
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "画像モデルを選択してください。" });
  });

  it("凍結教材と選択モデルに署名し、改変とモデル変更を拒否する", () => {
    vi.stubEnv("KYOZAI_E2E_MODE", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    const grant = issueRenderGrant(mockPackage, "gemini-3.1-flash-image");
    expect(() => verifyRenderGrant(grant, mockPackage, "gemini-3.1-flash-image")).not.toThrow();
    const changed = structuredClone(mockPackage);
    changed.slides[0]!.title = "改変した教材";
    expect(() => verifyRenderGrant(grant, changed, "gemini-3.1-flash-image")).toThrow("一致しません");
    expect(() => verifyRenderGrant(grant, mockPackage, "gpt-image-2-medium")).toThrow("一致しません");
    expect(() => verifyRenderGrant(`${grant}x`, mockPackage, "gemini-3.1-flash-image")).toThrow("検証できません");
    vi.unstubAllEnvs();
  });

  it("E2E経路でも実PNGを1672x941で返す", async () => {
    vi.stubEnv("KYOZAI_E2E_MODE", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    const renderGrant = issueRenderGrant(mockPackage, "gemini-3.1-flash-lite-image");
    const response = await POST(new Request("http://localhost/api/render-slide", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": crypto.randomUUID() },
      body: JSON.stringify({ package: mockPackage, slideNumber: 1, imageModel: "gemini-3.1-flash-lite-image", renderGrant }),
    }));
    const payload = await response.json() as { image: { width: number; height: number; data: string; imageHash: string } };
    expect(response.status).toBe(200);
    expect(payload.image).toMatchObject({ width: 1672, height: 941 });
    expect(Buffer.from(payload.image.data, "base64").subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(payload.image.imageHash).toMatch(/^[a-f0-9]{64}$/);
    vi.unstubAllEnvs();
  });

  it("Gemini公式SDK contractで1枚を生成し、QA不合格ページだけ1回再生成する", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const jpeg = await fixtureImage(1376, 768, "jpeg");
    const geminiResponse = () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: jpeg.toString("base64") } }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(geminiResponse())
      .mockResolvedValueOnce(qaResponse(false))
      .mockResolvedValueOnce(geminiResponse())
      .mockResolvedValueOnce(qaResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const image = await renderValidatedSlide(mockPackage, mockPackage.slides[0]!, "gemini-3.1-flash-image");

    expect(image).toMatchObject({ attemptCount: 2, providerModel: "gemini-3.1-flash-image", providerQuality: "1K", qaModel: "gpt-5.5" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { contents?: unknown[]; generationConfig?: Record<string, unknown>; tools?: unknown };
    expect(firstRequest).toMatchObject({ generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "1K" } } });
    expect(firstRequest.contents).toHaveLength(1);
    expect(firstRequest).not.toHaveProperty("tools");
  });

  it("画像pipelineの失敗を本文や秘密値を出さず段階とrequest IDで返す", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = publicErrorResponse(
      imagePipelineError({ stage: "image_qa_response", provider: "openai", model: "gpt-5.5" }, "画像QAの応答形式を確認できませんでした。", new Error("sensitive-source-value")),
      "fallback",
    );
    const payload = await response.json() as { stage?: string; requestId?: string; error?: string };
    expect(response.status).toBe(502);
    expect(payload).toMatchObject({ stage: "image_qa_response", error: "fallback" });
    expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(payload)).not.toContain("sensitive-source-value");
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('"stage":"image_qa_response"'));
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("sensitive-source-value");
    errorLog.mockRestore();
  });

  it("本文生成のtimeoutは現在工程と安全な相関IDだけを返す", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = publicErrorResponse(
      new PublicHttpError(504, "TIMEOUT", "AIの結果を確認できませんでした。"),
      "fallback",
      { requestId: "00000000-0000-4000-8000-000000000001", stage: "script_timing", elapsedMs: 12345 },
    );
    const payload = await response.json() as { stage?: string; requestId?: string; elapsedMs?: number };

    expect(response.status).toBe(504);
    expect(payload).toMatchObject({ stage: "script_timing", requestId: "00000000-0000-4000-8000-000000000001" });
    expect(JSON.stringify(payload)).not.toContain("12345");
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('"elapsedMs":12345'));
  });

  it("Gemini公式SDK形のinlineData応答と16:9の1K寸法を受け入れる", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const jpeg = await fixtureImage(1024, 576, "jpeg");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: jpeg.toString("base64") } }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(qaResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const image = await renderValidatedSlide(mockPackage, mockPackage.slides[0]!, "gemini-3.1-flash-lite-image");

    expect(image).toMatchObject({ width: 1672, height: 941, providerModel: "gemini-3.1-flash-lite-image" });
    expect(Buffer.from(image.data, "base64").length).toBeLessThan(3_200_000);
  });

  it("結果不明のtimeout時は画像生成を自動再送しない", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    await expect(renderValidatedSlide(mockPackage, mockPackage.slides[0]!, "gemini-3.1-flash-lite-image")).rejects.toThrow("自動再送はしていません");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("画像生成APIの429を台帳外で自動再送しない", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "rate limited" }), { status: 429, headers: { "retry-after": "0" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(renderValidatedSlide(mockPackage, mockPackage.slides[0]!, "gemini-3.1-flash-lite-image"))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("画像QAは単独の番号バッジをDATA外文字として扱わない", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const png = await fixtureImage(2048, 1152, "png");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200 }))
      .mockResolvedValueOnce(qaResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    await expect(renderValidatedSlide(mockPackage, mockPackage.slides[0]!, "gpt-image-2-medium")).resolves.toMatchObject({ providerModel: "gpt-image-2-2026-04-21" });
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? "{}")) as { input?: Array<{ content?: Array<{ text?: string }> }> };
    expect(body.input?.[0]?.content?.[0]?.text).toContain("単独の番号バッジ");
    expect(png.length).toBeGreaterThan(100);
  });

  it("高エントロピー画像でもVercelのJSON応答上限に収まるPNGへ正規化する", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const noisy = Buffer.alloc(1024 * 576 * 3);
    let seed = 0x12345678;
    for (let index = 0; index < noisy.length; index += 1) {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      noisy[index] = seed >>> 24;
    }
    const jpeg = await sharp(noisy, { raw: { width: 1024, height: 576, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: jpeg.toString("base64") } }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(qaResponse(true)));

    const image = await renderValidatedSlide(mockPackage, mockPackage.slides[0]!, "gemini-3.1-flash-lite-image");

    expect(Buffer.byteLength(JSON.stringify({ image }), "utf8")).toBeLessThan(4_500_000);
  }, 20_000);

  it("GPT Image 2 Mediumを固定snapshot・medium・2048x1152で生成する", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const png = await fixtureImage(2048, 1152, "png");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200 }))
      .mockResolvedValueOnce(qaResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const image = await renderValidatedSlide(mockPackage, mockPackage.slides[0]!, "gpt-image-2-medium");

    expect(image).toMatchObject({ providerModel: "gpt-image-2-2026-04-21", providerQuality: "medium", qaModel: "gpt-5.5" });
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(request).toMatchObject({ model: "gpt-image-2-2026-04-21", quality: "medium", size: "2048x1152", output_format: "png", n: 1 });
  });

  it("プレビューHTMLとZIPが同じ完成PNGを参照する", async () => {
    const images = await Promise.all(mockPackage.slides.map((slide) => mockRenderedSlide(mockPackage, slide, "gpt-image-2-medium")));
    const html = packageHtml(mockPackage, images);
    expect(html).toContain(imageDataUrl(images[0]!));
    const zipBlob = await createTeachingPackageZip(mockPackage, images, images[0]!.data);
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const cover = await zip.file("images/cover.png")?.async("base64");
    const action = await zip.file("images/action.png")?.async("base64");
    expect(cover).toBe(images[0]!.data);
    expect(action).toBe(images.at(-1)!.data);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("text")) as { imageModel: string; previewAndPackageShareFinalPng: boolean; images: unknown[] };
    expect(manifest).toMatchObject({ imageModel: "gpt-image-2-medium", previewAndPackageShareFinalPng: true });
    expect(manifest.images).toHaveLength(mockPackage.slides.length);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining([
      "deck-spec.json",
      "deck-content-and-script.txt",
      "source-info.json",
      "image-prompts.json",
      "image-validation.json",
      "montage.png",
      "manifest.json",
      "index.html",
    ]));
    const stageLedger = JSON.parse(await zip.file("stage-ledger.json")!.async("text")) as Array<{ stage: string; status: string }>;
    expect(stageLedger.filter((entry) => ["image_generate", "image_validate", "package"].includes(entry.stage)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ stage: "image_generate", status: "passed" }),
        expect.objectContaining({ stage: "image_validate", status: "passed" }),
        expect.objectContaining({ stage: "package", status: "passed" }),
      ]));
  });

  it("完成PNGの実バイトと申告hashが違うZIPを拒否する", async () => {
    const image = await mockRenderedSlide(mockPackage, mockPackage.slides[0]!, "gemini-3.1-flash-image");
    image.imageHash = "0".repeat(64);
    const images = await Promise.all(mockPackage.slides.map((slide) => mockRenderedSlide(mockPackage, slide, "gemini-3.1-flash-image")));
    images[0] = image;
    await expect(createTeachingPackageZip(mockPackage, images, images[1]!.data)).rejects.toThrow("実バイトと検証hashが一致しません");
  });
});
