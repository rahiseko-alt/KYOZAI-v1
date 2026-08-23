import { NextResponse } from "next/server";

import { isImageModelId } from "../../../lib/kyozai/image-models";
import { mockRenderedSlide, renderValidatedSlide } from "../../../lib/kyozai/image-renderer";
import { isProcessParityPipelineEnabled } from "../../../lib/kyozai/process-contract";
import { clientKey, rateLimit } from "../../../lib/kyozai/rate-limit";
import { verifyRenderGrant } from "../../../lib/kyozai/render-grant";
import { isTeachingPackage } from "../../../lib/kyozai/schema";

export const runtime = "nodejs";
export const maxDuration = 240;
const RENDER_ROUTE_BUDGET_MS = 225_000;

export async function POST(request: Request) {
  const deadlineMs = Date.now() + RENDER_ROUTE_BUDGET_MS;
  if (!isProcessParityPipelineEnabled()) return NextResponse.json({ error: "画像生成工程は現在開発中です。" }, { status: 503 });
  if (!rateLimit(`render-slide:${clientKey(request)}`, 40)) return NextResponse.json({ error: "画像生成の上限に達しました。15分ほど空けてお試しください。" }, { status: 429 });
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 256 * 1024) throw new Error("画像生成リクエストが上限を超えています。");
    const body = JSON.parse(raw) as { package?: unknown; slideNumber?: unknown; imageModel?: unknown; renderGrant?: unknown };
    if (!isTeachingPackage(body.package)) throw new Error("画像化する教材を確認できませんでした。");
    if (!Number.isInteger(body.slideNumber)) throw new Error("画像化するスライド番号を指定してください。");
    if (!isImageModelId(body.imageModel)) throw new Error("画像モデルを選択してください。");
    verifyRenderGrant(body.renderGrant, body.package, body.imageModel);
    const slide = body.package.slides.find((item) => item.number === body.slideNumber);
    if (!slide) throw new Error("画像化するスライドが見つかりません。");
    const e2eMode = process.env.KYOZAI_E2E_MODE === "1" && process.env.VERCEL_ENV !== "production";
    const image = e2eMode
      ? await mockRenderedSlide(body.package, slide, body.imageModel)
      : await renderValidatedSlide(body.package, slide, body.imageModel, deadlineMs);
    return NextResponse.json({ image });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "スライド画像を生成できませんでした。" }, { status: 400 });
  }
}
