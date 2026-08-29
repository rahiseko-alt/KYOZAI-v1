import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";

import { PublicHttpError } from "./http-errors";
import { ImagePipelineError, imagePipelineError } from "./image-pipeline-error";

export type GeminiSourceImage = {
  bytes: Buffer;
  format: "jpeg" | "png";
  providerModel: string;
  providerQuality: "1K";
};

function imageFormat(mimeType: unknown): "jpeg" | "png" | undefined {
  if (mimeType === "image/jpeg") return "jpeg";
  if (mimeType === "image/png") return "png";
  return undefined;
}

function hasMagic(bytes: Buffer, format: "jpeg" | "png") {
  return format === "jpeg"
    ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
}

export function extractGeminiInlineImage(payload: Pick<GenerateContentResponse, "candidates">, modelId: string): GeminiSourceImage {
  const images = (payload.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.inlineData)
    .filter((image): image is { data?: string; mimeType?: string } => Boolean(image));
  if (images.length !== 1) {
    throw imagePipelineError({ stage: "image_provider_response", provider: "google", model: modelId }, "Gemini画像生成の出力が1枚ではありませんでした。");
  }
  const image = images[0]!;
  const format = imageFormat(image.mimeType);
  if (!format || typeof image.data !== "string" || image.data.length < 100) {
    throw imagePipelineError({ stage: "image_decode", provider: "google", model: modelId }, "Gemini画像生成の画像形式を確認できませんでした。");
  }
  const bytes = Buffer.from(image.data, "base64");
  if (!hasMagic(bytes, format)) {
    throw imagePipelineError({ stage: "image_decode", provider: "google", model: modelId }, "Gemini画像生成の実バイトが画像形式と一致しませんでした。");
  }
  return { bytes, format, providerModel: modelId, providerQuality: "1K" };
}

export async function generateGeminiImage(apiKey: string, modelId: string, prompt: string, timeoutMs: number) {
  try {
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        abortSignal: AbortSignal.timeout(timeoutMs),
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "16:9", imageSize: "1K" },
      },
    });
    return extractGeminiInlineImage(response, modelId);
  } catch (error) {
    const diagnostic = { stage: "image_provider_response" as const, provider: "google" as const, model: modelId };
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : undefined;
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || error.name === "TypeError")) {
      throw new PublicHttpError(504, "TIMEOUT", "Gemini画像生成の結果を確認できませんでした。二重生成を避けるため自動再送はしていません。", undefined, diagnostic);
    }
    if (error instanceof ImagePipelineError) throw error;
    if (status === 429) {
      throw new PublicHttpError(503, "SERVICE_UNAVAILABLE", "Gemini画像生成が混雑しています。少し時間を置いてから再実行してください。", 60, diagnostic);
    }
    if (status) {
      throw new PublicHttpError(502, "UPSTREAM_FAILURE", "Gemini画像生成が応答を完了できませんでした。", undefined, diagnostic);
    }
    throw imagePipelineError(diagnostic, "Gemini画像生成が応答を完了できませんでした。", error);
  }
}
