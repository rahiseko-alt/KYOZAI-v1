import { NextResponse } from "next/server";

import { mockPackage } from "@/lib/kyozai/mock";
import { isImageModelId } from "@/lib/kyozai/image-models";
import { API_ROUTE_BUDGET_MS, revisePackage } from "@/lib/kyozai/openai";
import { isProcessParityPipelineEnabled } from "@/lib/kyozai/process-contract";
import { clientKey, rateLimit } from "@/lib/kyozai/rate-limit";
import { isTeachingPackage } from "@/lib/kyozai/schema";
import { issueRenderGrant } from "@/lib/kyozai/render-grant";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request: Request) {
  const deadlineMs = Date.now() + API_ROUTE_BUDGET_MS;
  if (!isProcessParityPipelineEnabled()) return NextResponse.json({ error: "画像生成工程は現在開発中です。公開準備が完了するまでお待ちください。" }, { status: 503 });
  if (!rateLimit(`revise:${clientKey(request)}`, 8)) return NextResponse.json({ error: "体験版の修正上限に達しました。15分ほど空けてお試しください。" }, { status: 429 });
  try {
    const body = (await request.json()) as { package?: unknown; request?: unknown; imageModel?: unknown };
    if (!isTeachingPackage(body.package)) throw new Error("修正対象の教材を確認できませんでした。");
    if (!isImageModelId(body.imageModel)) throw new Error("画像モデルを選択してください。");
    const requestText = typeof body.request === "string" ? body.request.trim() : "";
    if (requestText.length < 3 || requestText.length > 600) throw new Error("修正内容を3〜600文字で入力してください。");
    const e2eMode = process.env.KYOZAI_E2E_MODE === "1" && process.env.VERCEL_ENV !== "production";
    const result = e2eMode
      ? { ...mockPackage, title: `${mockPackage.title}（修正版）` }
      : await revisePackage(body.package, requestText, deadlineMs);
    return NextResponse.json({ package: result, renderGrant: issueRenderGrant(result, body.imageModel) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "教材を修正できませんでした。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
