import { NextResponse } from "next/server";

import { mockRevisionPlan } from "@/lib/kyozai/mock";
import { API_ROUTE_BUDGET_MS, revisePackage } from "@/lib/kyozai/openai";
import { clientKey, rateLimit } from "@/lib/kyozai/rate-limit";
import { extractRevisionScope, rejectedRevision, REVISION_BODY_LIMIT_BYTES, RevisionError } from "@/lib/kyozai/revision";
import { isTeachingPackage } from "@/lib/kyozai/schema";
import type { TeachingPackage } from "@/lib/kyozai/types";

export const runtime = "nodejs";
export const maxDuration = 240;

class RevisionBodyTooLargeError extends Error {}

async function readLimitedBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let raw = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > REVISION_BODY_LIMIT_BYTES) {
      await reader.cancel();
      throw new RevisionBodyTooLargeError("修正対象の教材が大きすぎます。");
    }
    raw += decoder.decode(value, { stream: true });
  }
  return raw + decoder.decode();
}

export async function POST(request: Request) {
  const deadlineMs = Date.now() + API_ROUTE_BUDGET_MS;
  if (!rateLimit(`revise:${clientKey(request)}`, 8)) return NextResponse.json({ error: "体験版の修正上限に達しました。15分ほど空けてお試しください。" }, { status: 429 });
  let base: TeachingPackage | null = null;
  let baseVersionId: string | undefined;
  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > REVISION_BODY_LIMIT_BYTES) return NextResponse.json({ error: "修正対象の教材が大きすぎます。" }, { status: 413 });
    const raw = await readLimitedBody(request);
    let body: { package?: unknown; request?: unknown; selectedSlideNumber?: unknown; baseVersionId?: unknown };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return NextResponse.json({ error: "修正依頼の形式を確認できませんでした。" }, { status: 400 });
    }
    if (!isTeachingPackage(body.package)) throw new Error("修正対象の教材を確認できませんでした。");
    base = body.package;
    const requestText = typeof body.request === "string" ? body.request.trim() : "";
    if (requestText.length < 3 || requestText.length > 600) throw new Error("修正内容を3〜600文字で入力してください。");
    const selectedSlideNumber = body.selectedSlideNumber === undefined ? undefined : Number(body.selectedSlideNumber);
    if (selectedSlideNumber !== undefined && !Number.isInteger(selectedSlideNumber)) throw new Error("選択中のスライドを確認できませんでした。");
    if (body.baseVersionId !== undefined && (typeof body.baseVersionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(body.baseVersionId))) {
      throw new Error("教材の版情報を確認できませんでした。");
    }
    baseVersionId = body.baseVersionId as string | undefined;
    const e2eMode = process.env.KYOZAI_E2E_MODE === "1" && process.env.VERCEL_ENV !== "production";
    const scope = e2eMode ? extractRevisionScope(requestText, selectedSlideNumber, base.slides.length) : null;
    const result = await revisePackage(base, requestText, {
      selectedSlideNumber,
      baseVersionId,
      deadlineMs,
      planOverride: scope ? mockRevisionPlan(base, scope.targetSlides) : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "教材を修正できませんでした。";
    if (error instanceof RevisionBodyTooLargeError) return NextResponse.json({ error: message }, { status: 413 });
    if (base && error instanceof RevisionError) {
      return NextResponse.json({ error: message, package: base, revision: rejectedRevision(base, error, baseVersionId) }, { status: error.statusCode });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
