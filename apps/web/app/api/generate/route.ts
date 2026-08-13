import { NextResponse } from "next/server";

import { API_ROUTE_BUDGET_MS, generatePackage } from "@/lib/kyozai/openai";
import { mockPackage } from "@/lib/kyozai/mock";
import { clientKey, rateLimit } from "@/lib/kyozai/rate-limit";
import { sourcesFromFormData } from "@/lib/kyozai/source";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request: Request) {
  const deadlineMs = Date.now() + API_ROUTE_BUDGET_MS;
  if (!rateLimit(`generate:${clientKey(request)}`, 3)) return NextResponse.json({ error: "体験版の生成上限に達しました。15分ほど空けてお試しください。" }, { status: 429 });
  try {
    const form = await request.formData();
    const requestText = String(form.get("request") || "").trim();
    if (requestText.length < 8 || requestText.length > 1000) throw new Error("教材への要望を8〜1000文字で入力してください。");
    const sources = await sourcesFromFormData(form, deadlineMs);
    const e2eMode = process.env.KYOZAI_E2E_MODE === "1" && process.env.VERCEL_ENV !== "production";
    const result = e2eMode ? mockPackage : await generatePackage(sources, requestText, deadlineMs);
    return NextResponse.json({ package: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "教材を生成できませんでした。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
