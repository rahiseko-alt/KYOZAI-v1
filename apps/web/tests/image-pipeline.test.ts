import JSZip from "jszip";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/render-slide/route";
import { isImageModelId } from "../lib/kyozai/image-models";
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

  it("審査済みモデルだけを受け入れ、既定モデルを持たない", () => {
    expect(isImageModelId("gemini-3.1-flash-lite-image")).toBe(true);
    expect(isImageModelId("gemini-3.1-flash-image")).toBe(true);
    expect(isImageModelId("gpt-image-2-medium")).toBe(true);
    expect(isImageModelId("gpt-image-2-high")).toBe(false);
    expect(isImageModelId(undefined)).toBe(false);
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

  it("Gemini公式contractで1枚を生成し、QA不合格ページだけ1回再生成する", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const jpeg = await fixtureImage(1376, 768, "jpeg");
    const geminiResponse = () => new Response(JSON.stringify({
      status: "completed",
      steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/jpeg", data: jpeg.toString("base64") }] }],
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
    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { model: string; input: unknown[]; response_format: Record<string, unknown>; tools?: unknown };
    expect(firstRequest).toMatchObject({ model: "gemini-3.1-flash-image", response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "16:9", image_size: "1K" } });
    expect(firstRequest.response_format).not.toHaveProperty("delivery");
    expect(firstRequest).not.toHaveProperty("tools");
  });

  it("Gemini公式SDK形のoutput_image応答と16:9の1K寸法を受け入れる", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const jpeg = await fixtureImage(1024, 576, "jpeg");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_image: { mime_type: "image/jpeg", data: jpeg.toString("base64") },
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
        status: "completed",
        steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/jpeg", data: jpeg.toString("base64") }] }],
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
