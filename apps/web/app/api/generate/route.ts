import { NextResponse } from "next/server";

import { generatePackage } from "@/lib/kyozai/content-generation";
import { API_ROUTE_BUDGET_MS } from "@/lib/kyozai/openai";
import { isImageModelId } from "@/lib/kyozai/image-models";
import { mockPackage } from "@/lib/kyozai/mock";
import { isProcessParityPipelineEnabled } from "@/lib/kyozai/process-contract";
import { clientKey, rateLimit } from "@/lib/kyozai/rate-limit";
import { sourcesFromFormData } from "@/lib/kyozai/source";
import { issueRenderGrant } from "@/lib/kyozai/render-grant";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request: Request) {
  const deadlineMs = Date.now() + API_ROUTE_BUDGET_MS;
  if (!isProcessParityPipelineEnabled()) return NextResponse.json({ error: "画像生成工程は現在開発中です。公開準備が完了するまでお待ちください。" }, { status: 503 });
  if (!rateLimit(`generate:${clientKey(request)}`, 3)) return NextResponse.json({ error: "体験版の生成上限に達しました。15分ほど空けてお試しください。" }, { status: 429 });
  try {
    const form = await request.formData();
    const requestText = String(form.get("request") || "").trim();
    const imageModel = form.get("imageModel");
    if (requestText.length < 8 || requestText.length > 1000) throw new Error("教材への要望を8〜1000文字で入力してください。");
    if (!isImageModelId(imageModel)) throw new Error("画像モデルを選択してください。");
    const sources = await sourcesFromFormData(form, deadlineMs);
    const e2eMode = process.env.KYOZAI_E2E_MODE === "1" && process.env.VERCEL_ENV !== "production";
    const result = e2eMode ? mockPackage : await generatePackage(sources, requestText, deadlineMs);
    return NextResponse.json({ package: result, renderGrant: issueRenderGrant(result, imageModel) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "教材を生成できませんでした。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
