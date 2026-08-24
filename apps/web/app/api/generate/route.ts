import { NextResponse } from "next/server";

import { readBoundedFormData } from "../../../lib/kyozai/bounded-body";
import { generatePackage } from "../../../lib/kyozai/content-generation";
import { generationIsAvailable } from "../../../lib/kyozai/generation-access";
import { badRequest, publicErrorResponse, routeUnavailable } from "../../../lib/kyozai/http-errors";
import { API_ROUTE_BUDGET_MS } from "../../../lib/kyozai/openai";
import { isImageModelId } from "../../../lib/kyozai/image-models";
import { mockPackage } from "../../../lib/kyozai/mock";
import { enforceRateLimit } from "../../../lib/kyozai/rate-limit";
import { sourcesFromFormData } from "../../../lib/kyozai/source";
import { issueRenderGrant } from "../../../lib/kyozai/render-grant";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request: Request) {
  const deadlineMs = Date.now() + API_ROUTE_BUDGET_MS;
  try {
    if (!generationIsAvailable()) throw routeUnavailable();
    await enforceRateLimit(request, "generate");
    const form = await readBoundedFormData(request, 4 * 1024 * 1024, "生成リクエストは4MB以下にしてください。");
    const requestText = String(form.get("request") || "").trim();
    const imageModel = form.get("imageModel");
    if (requestText.length < 8 || requestText.length > 1000) throw badRequest("教材への要望を8〜1000文字で入力してください。");
    if (!isImageModelId(imageModel)) throw badRequest("画像モデルを選択してください。");
    const sources = await sourcesFromFormData(form, deadlineMs);
    const e2eMode = process.env.KYOZAI_E2E_MODE === "1" && process.env.VERCEL_ENV !== "production";
    const result = e2eMode ? mockPackage : await generatePackage(sources, requestText, deadlineMs);
    return NextResponse.json({ package: result, renderGrant: issueRenderGrant(result, imageModel) });
  } catch (error) {
    return publicErrorResponse(error, "教材を生成できませんでした。入力内容を確認してもう一度お試しください。");
  }
}
