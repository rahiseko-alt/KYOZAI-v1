import { NextResponse } from "next/server";

import { readBoundedText } from "../../../lib/kyozai/bounded-body";
import { generationIsAvailable } from "../../../lib/kyozai/generation-access";
import { badRequest, publicErrorResponse, routeUnavailable } from "../../../lib/kyozai/http-errors";
import { isImageModelId } from "../../../lib/kyozai/image-models";
import { mockRenderedSlide, renderValidatedSlide } from "../../../lib/kyozai/image-renderer";
import { enforceRateLimit } from "../../../lib/kyozai/rate-limit";
import { verifyRenderGrant } from "../../../lib/kyozai/render-grant";
import { isTeachingPackage } from "../../../lib/kyozai/schema";

export const runtime = "nodejs";
export const maxDuration = 240;
const RENDER_ROUTE_BUDGET_MS = 225_000;

export async function POST(request: Request) {
  const deadlineMs = Date.now() + RENDER_ROUTE_BUDGET_MS;
  try {
    if (!generationIsAvailable()) throw routeUnavailable();
    const raw = await readBoundedText(request, 256 * 1024, "画像生成リクエストが上限を超えています。");
    let body: { package?: unknown; slideNumber?: unknown; imageModel?: unknown; renderGrant?: unknown };
    try { body = JSON.parse(raw) as typeof body; } catch { throw badRequest("画像生成リクエストの形式が不正です。"); }
    if (!isTeachingPackage(body.package)) throw badRequest("画像化する教材を確認できませんでした。");
    if (!Number.isInteger(body.slideNumber)) throw badRequest("画像化するスライド番号を指定してください。");
    if (!isImageModelId(body.imageModel)) throw badRequest("画像モデルを選択してください。");
    verifyRenderGrant(body.renderGrant, body.package, body.imageModel);
    await enforceRateLimit(request, "render-slide", { renderGrant: body.renderGrant as string, slideNumber: body.slideNumber as number });
    const slide = body.package.slides.find((item) => item.number === body.slideNumber);
    if (!slide) throw badRequest("画像化するスライドが見つかりません。");
    const e2eMode = process.env.KYOZAI_E2E_MODE === "1" && process.env.VERCEL_ENV !== "production";
    const image = e2eMode
      ? await mockRenderedSlide(body.package, slide, body.imageModel)
      : await renderValidatedSlide(body.package, slide, body.imageModel, deadlineMs);
    return NextResponse.json({ image });
  } catch (error) {
    return publicErrorResponse(error, "スライド画像を生成できませんでした。時間を置いてもう一度お試しください。");
  }
}
