import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { ImageModelId } from "./image-models";
import { PublicHttpError, badRequest } from "./http-errors";
import type { TeachingPackage } from "./types";

type RenderGrantPayload = {
  version: 2;
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

const E2E_RENDER_GRANT_SECRET = "kyozai-e2e-render-grant-secret-32-bytes-minimum";

function validateSecret(value: string | undefined) {
  if (!value || Buffer.byteLength(value, "utf8") < 32) {
    throw new PublicHttpError(503, "SERVICE_UNAVAILABLE", "画像生成の署名設定が不正です。管理者へお問い合わせください。");
  }
  return value;
}

function currentSecret() {
  if (process.env.KYOZAI_E2E_MODE === "1" && process.env.VERCEL_ENV !== "production") return E2E_RENDER_GRANT_SECRET;
  if (process.env.KYOZAI_RENDER_GRANT_SECRET) return validateSecret(process.env.KYOZAI_RENDER_GRANT_SECRET);
  throw new PublicHttpError(503, "SERVICE_UNAVAILABLE", "画像生成の署名設定がありません。管理者へお問い合わせください。");
}

function verificationSecrets() {
  const secrets = [currentSecret()];
  if (process.env.KYOZAI_RENDER_GRANT_SECRET_PREVIOUS) {
    secrets.push(validateSecret(process.env.KYOZAI_RENDER_GRANT_SECRET_PREVIOUS));
  }
  return secrets;
}

function packageHash(result: TeachingPackage) {
  return createHash("sha256").update(canonical(result)).digest("hex");
}

function signature(encodedPayload: string, value = currentSecret()) {
  return createHmac("sha256", value).update(encodedPayload).digest("base64url");
}

function signatureMatches(encodedPayload: string, providedSignature: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(providedSignature)) return false;
  const provided = Buffer.from(providedSignature, "base64url");
  return verificationSecrets().some((value) => {
    const expected = Buffer.from(signature(encodedPayload, value), "base64url");
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}

export function issueRenderGrant(result: TeachingPackage, imageModel: ImageModelId) {
  const payload: RenderGrantPayload = {
    version: 2,
    packageHash: packageHash(result),
    imageModel,
    slideCount: result.slides.length,
    expiresAt: Date.now() + 15 * 60_000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signature(encodedPayload)}`;
}

export function verifyRenderGrant(grant: unknown, result: TeachingPackage, imageModel: ImageModelId) {
  if (typeof grant !== "string" || grant.length > 2048) throw badRequest("画像生成の許可を確認できませんでした。教材をもう一度生成してください。");
  const [encodedPayload, providedSignature, extra] = grant.split(".");
  if (!encodedPayload || !providedSignature || extra) throw badRequest("画像生成の許可形式が不正です。");
  if (!signatureMatches(encodedPayload, providedSignature)) throw badRequest("画像生成の許可を検証できませんでした。");
  let payload: RenderGrantPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as RenderGrantPayload;
  } catch {
    throw badRequest("画像生成の許可内容が不正です。");
  }
  if (payload.version !== 2 || payload.expiresAt < Date.now() || payload.imageModel !== imageModel || payload.slideCount !== result.slides.length || payload.packageHash !== packageHash(result)) {
    throw badRequest("画像生成の許可が教材または選択モデルと一致しません。");
  }
}
