import { NextResponse } from "next/server";

import { readBoundedText } from "../../../lib/kyozai/bounded-body";
import { generationIsAvailable } from "../../../lib/kyozai/generation-access";
import { badRequest, publicErrorResponse, routeUnavailable } from "../../../lib/kyozai/http-errors";
import { mockPackage } from "../../../lib/kyozai/mock";
import { isImageModelId } from "../../../lib/kyozai/image-models";
import { API_ROUTE_BUDGET_MS, revisePackage } from "../../../lib/kyozai/openai";
import { enforceRateLimit } from "../../../lib/kyozai/rate-limit";
import { isTeachingPackage } from "../../../lib/kyozai/schema";
import { issueRenderGrant } from "../../../lib/kyozai/render-grant";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request: Request) {
  const deadlineMs = Date.now() + API_ROUTE_BUDGET_MS;
  try {
    if (!generationIsAvailable()) throw routeUnavailable();
    await enforceRateLimit(request, "revise");
    const raw = await readBoundedText(request, 256 * 1024, "修正リクエストが上限を超えています。");
    let body: { package?: unknown; request?: unknown; imageModel?: unknown };
    try { body = JSON.parse(raw) as typeof body; } catch { throw badRequest("修正リクエストの形式が不正です。"); }
    if (!isTeachingPackage(body.package)) throw badRequest("修正対象の教材を確認できませんでした。");
    if (!isImageModelId(body.imageModel)) throw badRequest("画像モデルを選択してください。");
    const requestText = typeof body.request === "string" ? body.request.trim() : "";
    if (requestText.length < 3 || requestText.length > 600) throw badRequest("修正内容を3〜600文字で入力してください。");
    const e2eMode = process.env.KYOZAI_E2E_MODE === "1" && process.env.VERCEL_ENV !== "production";
    const result = e2eMode
      ? { ...mockPackage, title: `${mockPackage.title}（修正版）` }
      : await revisePackage(body.package, requestText, deadlineMs);
    return NextResponse.json({ package: result, renderGrant: issueRenderGrant(result, body.imageModel) });
  } catch (error) {
    return publicErrorResponse(error, "教材を修正できませんでした。元の教材は維持されています。");
  }
}
