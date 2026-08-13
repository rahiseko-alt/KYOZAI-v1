import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { ImageModelId } from "./image-models";
import type { TeachingPackage } from "./types";

type RenderGrantPayload = {
  version: 1;
  packageHash: string;
  imageModel: ImageModelId;
  slideCount: number;
  expiresAt: number;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function secret() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (process.env.KYOZAI_E2E_MODE === "1" && process.env.VERCEL_ENV !== "production") return "e2e-process-only-render-grant";
  throw new Error("画像生成の署名設定がありません。管理者へお問い合わせください。");
}

function packageHash(result: TeachingPackage) {
  return createHash("sha256").update(canonical(result)).digest("hex");
}

function signature(encodedPayload: string) {
  return createHmac("sha256", secret()).update(encodedPayload).digest("base64url");
}

export function issueRenderGrant(result: TeachingPackage, imageModel: ImageModelId) {
  const payload: RenderGrantPayload = {
    version: 1,
    packageHash: packageHash(result),
    imageModel,
    slideCount: result.slides.length,
    expiresAt: Date.now() + 15 * 60_000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signature(encodedPayload)}`;
}

export function verifyRenderGrant(grant: unknown, result: TeachingPackage, imageModel: ImageModelId) {
  if (typeof grant !== "string" || grant.length > 2048) throw new Error("画像生成の許可を確認できませんでした。教材をもう一度生成してください。");
  const [encodedPayload, providedSignature, extra] = grant.split(".");
  if (!encodedPayload || !providedSignature || extra) throw new Error("画像生成の許可形式が不正です。");
  const expectedSignature = signature(encodedPayload);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new Error("画像生成の許可を検証できませんでした。");
  let payload: RenderGrantPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as RenderGrantPayload;
  } catch {
    throw new Error("画像生成の許可内容が不正です。");
  }
  if (payload.version !== 1 || payload.expiresAt < Date.now() || payload.imageModel !== imageModel || payload.slideCount !== result.slides.length || payload.packageHash !== packageHash(result)) {
    throw new Error("画像生成の許可が教材または選択モデルと一致しません。");
  }
}
